# Dynamic SQL fragments come only from fixed allowlists; request values stay bound.
# ruff: noqa: S608
from starlette.responses import JSONResponse

from backend.admin.platform_directory_routes import (
    _InvalidDirectoryQuery,
    _forbidden_or_role,
    _json_value,
    _pagination,
    _parse_common_query,
)
from backend.shared.async_io import BlockingIOBusyError, BlockingIOTimeoutError
from backend.shared.database_io import run_database_read
from backend.shared.helpers import database, log_error


_SUBSCRIPTION_SORT_COLUMNS = {
    "owner": "lower(COALESCE(subscription.owner_name, ''))",
    "status": "subscription.status",
    "starts_at": "subscription.starts_at",
    "expires_at": "subscription.expires_at",
    "created_at": "subscription.created_at",
    "updated_at": "subscription.updated_at",
}
_PAYMENT_SORT_COLUMNS = {
    "created_at": "orders.created_at",
    "updated_at": "orders.updated_at",
    "total_amount": "orders.total_amount",
    "payment_state": "orders.payment_state",
    "checkout_state": "orders.checkout_state",
}
_INVOICE_SORT_COLUMNS = {
    "status": "invoice_requests.status",
    "created_at": "invoice_requests.created_at",
    "updated_at": "invoice_requests.updated_at",
}
_SUBSCRIPTION_STATUSES = {"", "active", "suspended", "expired", "cancelled"}
_OWNER_KINDS = {"", "account", "organization"}
_OPERATIONS = {"", "purchase", "renew", "upgrade", "downgrade", "credit_pack"}
_CHECKOUT_STATES = {"", "creating", "open", "create_failed", "cancelled", "expired"}
_PAYMENT_STATES = {
    "", "unverified", "verified_paid", "refund_pending",
    "partially_refunded", "refunded", "refund_failed",
}
_ACTIVATION_STATES = {
    "", "not_ready", "pending", "applied", "retry",
    "review_required", "reversed",
}
_TRANSACTION_STATUSES = {"", "verified", "settled", "failed"}
_INVOICE_STATUSES = {"", "requested", "issued", "failed"}


def _bounded_identifier(value, label):
    normalized = str(value or "").strip()
    if len(normalized) > 200:
        raise _InvalidDirectoryQuery(f"{label} không hợp lệ.")
    return normalized


def _subscription_union_sql():
    return """
        SELECT 'account' AS owner_kind, account_subscription.user_id AS owner_id,
               COALESCE(account.ho_ten, account.ten_dang_nhap, account.email) AS owner_name,
               account.email AS owner_email, account_subscription.package_id,
               account_subscription.plan_version_id, account_subscription.status,
               account_subscription.source, account_subscription.source_order_id,
               account_order.public_id AS source_order_public_id,
               account_subscription.starts_at, account_subscription.expires_at,
               NULL AS member_quota, account_subscription.revision,
               account_subscription.created_at, account_subscription.updated_at
          FROM account_subscriptions account_subscription
          JOIN tai_khoan account ON account.id = account_subscription.user_id
          LEFT JOIN billing_orders account_order
            ON account_order.id = account_subscription.source_order_id
        UNION ALL
        SELECT 'organization' AS owner_kind,
               organization_subscription.organization_id AS owner_id,
               organization.ten_to_chuc AS owner_name, NULL AS owner_email,
               organization_subscription.package_id,
               organization_subscription.plan_version_id,
               organization_subscription.status, organization_subscription.source,
               organization_subscription.source_order_id,
               organization_order.public_id AS source_order_public_id,
               organization_subscription.starts_at, organization_subscription.expires_at,
               organization_subscription.member_quota,
               organization_subscription.revision,
               organization_subscription.created_at,
               organization_subscription.updated_at
          FROM organization_subscriptions organization_subscription
          JOIN to_chuc organization
            ON organization.id = organization_subscription.organization_id
          LEFT JOIN billing_orders organization_order
            ON organization_order.id = organization_subscription.source_order_id
           AND organization_order.organization_id = organization_subscription.organization_id
    """


def _list_admin_subscriptions_sync(request):
    denied, _role = _forbidden_or_role(request)
    if denied:
        return denied
    try:
        page, page_size, search, sort_by, sort_direction = _parse_common_query(
            request,
            sort_columns=_SUBSCRIPTION_SORT_COLUMNS,
            default_sort="updated_at",
            allowed_filters={"ownerKind", "status", "packageId", "planVersionId", "source"},
        )
        if "sortDir" not in request.query_params:
            sort_direction = "desc"
        owner_kind = str(request.query_params.get("ownerKind") or "").strip().lower()
        status = str(request.query_params.get("status") or "").strip().lower()
        package_id = _bounded_identifier(request.query_params.get("packageId"), "Gói dịch vụ")
        plan_version_id = _bounded_identifier(request.query_params.get("planVersionId"), "Phiên bản gói")
        source = str(request.query_params.get("source") or "").strip().lower()
        if owner_kind not in _OWNER_KINDS:
            raise _InvalidDirectoryQuery("Loại chủ thể không hợp lệ.")
        if status not in _SUBSCRIPTION_STATUSES:
            raise _InvalidDirectoryQuery("Trạng thái thuê bao không hợp lệ.")
        if source not in {"", "legacy", "admin", "order"}:
            raise _InvalidDirectoryQuery("Nguồn thuê bao không hợp lệ.")

        predicates = []
        values = []
        if search:
            term = f"%{search.lower()}%"
            predicates.append(
                "(lower(COALESCE(subscription.owner_name, '')) LIKE ? "
                "OR lower(COALESCE(subscription.owner_email, '')) LIKE ? "
                "OR lower(subscription.owner_id) LIKE ? "
                "OR lower(subscription.package_id) LIKE ?)"
            )
            values.extend((term, term, term, term))
        for column, value in (
            ("owner_kind", owner_kind), ("status", status),
            ("package_id", package_id), ("plan_version_id", plan_version_id),
            ("source", source),
        ):
            if value:
                predicates.append(f"subscription.{column} = ?")
                values.append(value)
        where_sql = f" WHERE {' AND '.join(predicates)}" if predicates else ""
        union_sql = _subscription_union_sql()

        connection = database.get_connection()
        try:
            cursor = connection.cursor()
            cursor.execute(
                f"SELECT COUNT(*) AS total_rows FROM ({union_sql}) subscription{where_sql}",
                tuple(values),
            )
            total_rows = int(cursor.fetchone()["total_rows"])
            cursor.execute(
                f"""SELECT subscription.* FROM ({union_sql}) subscription{where_sql}
                     ORDER BY {_SUBSCRIPTION_SORT_COLUMNS[sort_by]} {sort_direction.upper()},
                              subscription.owner_kind, subscription.owner_id
                     LIMIT ? OFFSET ?""",
                (*values, page_size, (page - 1) * page_size),
            )
            rows = cursor.fetchall()
        finally:
            connection.close()

        items = []
        for row in rows:
            items.append(
                {
                    "owner": {
                        "kind": row["owner_kind"],
                        "id": row["owner_id"],
                        "name": row["owner_name"],
                        "email": row["owner_email"],
                    },
                    "packageId": row["package_id"],
                    "planVersionId": row["plan_version_id"],
                    "status": row["status"],
                    "source": row["source"],
                    "sourceOrderPublicId": row["source_order_public_id"],
                    "startsAt": _json_value(row["starts_at"]),
                    "expiresAt": _json_value(row["expires_at"]),
                    "memberQuota": (
                        int(row["member_quota"])
                        if row["member_quota"] is not None
                        else None
                    ),
                    "revision": int(row["revision"]),
                    "createdAt": _json_value(row["created_at"]),
                    "updatedAt": _json_value(row["updated_at"]),
                }
            )
        return JSONResponse(
            {
                "items": items,
                "pagination": _pagination(page, page_size, total_rows),
                "sort": {"by": sort_by, "direction": sort_direction},
                "filters": {
                    "search": search,
                    "ownerKind": owner_kind,
                    "status": status,
                    "packageId": package_id,
                    "planVersionId": plan_version_id,
                    "source": source,
                },
            },
            headers={"Cache-Control": "private, no-store"},
        )
    except _InvalidDirectoryQuery as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001 - keep database details private.
        log_error(exc, "list_platform_admin_subscriptions")
        return JSONResponse({"error": "Đã xảy ra lỗi tải danh sách thuê bao."}, status_code=500)


async def list_admin_subscriptions_api(request):
    try:
        return await run_database_read(_list_admin_subscriptions_sync, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = JSONResponse({"error": "Hệ thống đang bận. Vui lòng thử lại sau."}, status_code=503)
        response.headers["Retry-After"] = "1"
        return response


def _list_admin_payments_sync(request):
    denied, _role = _forbidden_or_role(request)
    if denied:
        return denied
    try:
        page, page_size, search, sort_by, sort_direction = _parse_common_query(
            request,
            sort_columns=_PAYMENT_SORT_COLUMNS,
            default_sort="created_at",
            allowed_filters={
                "ownerKind", "operation", "checkoutState", "paymentState",
                "activationState", "transactionStatus",
            },
        )
        if "sortDir" not in request.query_params:
            sort_direction = "desc"
        owner_kind = str(request.query_params.get("ownerKind") or "").strip().lower()
        operation = str(request.query_params.get("operation") or "").strip().lower()
        checkout_state = str(request.query_params.get("checkoutState") or "").strip().lower()
        payment_state = str(request.query_params.get("paymentState") or "").strip().lower()
        activation_state = str(request.query_params.get("activationState") or "").strip().lower()
        transaction_status = str(request.query_params.get("transactionStatus") or "").strip().lower()
        if owner_kind not in _OWNER_KINDS:
            raise _InvalidDirectoryQuery("Loại chủ thể không hợp lệ.")
        if operation not in _OPERATIONS:
            raise _InvalidDirectoryQuery("Loại giao dịch không hợp lệ.")
        if checkout_state not in _CHECKOUT_STATES:
            raise _InvalidDirectoryQuery("Trạng thái checkout không hợp lệ.")
        if payment_state not in _PAYMENT_STATES:
            raise _InvalidDirectoryQuery("Trạng thái thanh toán không hợp lệ.")
        if activation_state not in _ACTIVATION_STATES:
            raise _InvalidDirectoryQuery("Trạng thái kích hoạt không hợp lệ.")
        if transaction_status not in _TRANSACTION_STATUSES:
            raise _InvalidDirectoryQuery("Trạng thái giao dịch không hợp lệ.")

        predicates = []
        values = []
        if search:
            term = f"%{search.lower()}%"
            predicates.append(
                "(lower(orders.public_id) LIKE ? OR lower(orders.provider_reference) LIKE ? "
                "OR lower(COALESCE(account.ho_ten, account.email, '')) LIKE ? "
                "OR lower(COALESCE(organization.ten_to_chuc, '')) LIKE ?)"
            )
            values.extend((term, term, term, term))
        for column, value in (
            ("owner_kind", owner_kind), ("operation", operation),
            ("checkout_state", checkout_state), ("payment_state", payment_state),
            ("activation_state", activation_state),
        ):
            if value:
                predicates.append(f"orders.{column} = ?")
                values.append(value)
        if transaction_status:
            predicates.append(
                "EXISTS (SELECT 1 FROM payment_transactions filtered_transaction "
                "WHERE filtered_transaction.order_id = orders.id "
                "AND filtered_transaction.status = ?)"
            )
            values.append(transaction_status)
        where_sql = f" WHERE {' AND '.join(predicates)}" if predicates else ""
        joins = """
            LEFT JOIN tai_khoan account ON account.id = orders.account_user_id
            LEFT JOIN to_chuc organization ON organization.id = orders.organization_id
            LEFT JOIN payment_provider_profiles provider
              ON provider.id = orders.provider_profile_id
        """

        connection = database.get_connection()
        try:
            cursor = connection.cursor()
            cursor.execute(
                f"SELECT COUNT(*) AS total_rows FROM billing_orders orders{joins}{where_sql}",
                tuple(values),
            )
            total_rows = int(cursor.fetchone()["total_rows"])
            cursor.execute(
                f"""SELECT orders.id, orders.public_id, orders.account_user_id,
                           orders.organization_id, orders.owner_kind, orders.operation,
                           orders.subtotal_amount, orders.tax_amount, orders.total_amount,
                           orders.currency, orders.checkout_state, orders.payment_state,
                           orders.activation_state, orders.checkout_expires_at,
                           orders.provider_order_code, orders.provider_reference,
                           orders.created_at, orders.updated_at,
                           COALESCE(account.ho_ten, account.ten_dang_nhap, account.email) AS account_name,
                           organization.ten_to_chuc AS organization_name,
                           provider.provider, provider.environment AS provider_environment
                      FROM billing_orders orders{joins}{where_sql}
                     ORDER BY {_PAYMENT_SORT_COLUMNS[sort_by]} {sort_direction.upper()}, orders.id
                     LIMIT ? OFFSET ?""",
                (*values, page_size, (page - 1) * page_size),
            )
            rows = cursor.fetchall()
            order_ids = [row["id"] for row in rows]
            transactions_by_order = {order_id: [] for order_id in order_ids}
            if order_ids:
                placeholders = ",".join("?" for _ in order_ids)
                cursor.execute(
                    f"""SELECT id, order_id, provider_transaction_id,
                               transaction_type, status, verified_paid_amount,
                               fee_amount, net_settled_amount, currency,
                               payment_timing, provider_occurred_at, created_at
                          FROM payment_transactions
                         WHERE order_id IN ({placeholders})
                         ORDER BY created_at, id""",
                    tuple(order_ids),
                )
                for transaction in cursor.fetchall():
                    transactions_by_order[transaction["order_id"]].append(
                        {
                            "id": transaction["id"],
                            "providerTransactionId": transaction["provider_transaction_id"],
                            "type": transaction["transaction_type"],
                            "status": transaction["status"],
                            "verifiedPaidAmountMinor": int(transaction["verified_paid_amount"]),
                            "feeAmountMinor": int(transaction["fee_amount"]),
                            "netSettledAmountMinor": int(transaction["net_settled_amount"]),
                            "currency": transaction["currency"],
                            "paymentTiming": transaction["payment_timing"],
                            "providerOccurredAt": _json_value(transaction["provider_occurred_at"]),
                            "createdAt": _json_value(transaction["created_at"]),
                        }
                    )
        finally:
            connection.close()

        items = []
        for row in rows:
            owner_id = row["account_user_id"] if row["owner_kind"] == "account" else row["organization_id"]
            owner_name = row["account_name"] if row["owner_kind"] == "account" else row["organization_name"]
            items.append(
                {
                    "publicId": row["public_id"],
                    "owner": {"kind": row["owner_kind"], "id": owner_id, "name": owner_name},
                    "operation": row["operation"],
                    "amounts": {
                        "subtotalMinor": int(row["subtotal_amount"]),
                        "taxMinor": int(row["tax_amount"]),
                        "totalMinor": int(row["total_amount"]),
                        "currency": row["currency"],
                    },
                    "checkoutState": row["checkout_state"],
                    "paymentState": row["payment_state"],
                    "activationState": row["activation_state"],
                    "checkoutExpiresAt": _json_value(row["checkout_expires_at"]),
                    "provider": {
                        "name": row["provider"],
                        "environment": row["provider_environment"],
                        "reference": row["provider_reference"],
                        "orderCode": row["provider_order_code"],
                    },
                    "transactions": transactions_by_order[row["id"]],
                    "createdAt": _json_value(row["created_at"]),
                    "updatedAt": _json_value(row["updated_at"]),
                }
            )
        return JSONResponse(
            {
                "items": items,
                "pagination": _pagination(page, page_size, total_rows),
                "sort": {"by": sort_by, "direction": sort_direction},
                "filters": {
                    "search": search,
                    "ownerKind": owner_kind,
                    "operation": operation,
                    "checkoutState": checkout_state,
                    "paymentState": payment_state,
                    "activationState": activation_state,
                    "transactionStatus": transaction_status,
                },
            },
            headers={"Cache-Control": "private, no-store"},
        )
    except _InvalidDirectoryQuery as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001 - keep database details private.
        log_error(exc, "list_platform_admin_payments")
        return JSONResponse({"error": "Đã xảy ra lỗi tải danh sách thanh toán."}, status_code=500)


async def list_admin_payments_api(request):
    try:
        return await run_database_read(_list_admin_payments_sync, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = JSONResponse({"error": "Hệ thống đang bận. Vui lòng thử lại sau."}, status_code=503)
        response.headers["Retry-After"] = "1"
        return response


def _invoice_request_select_sql():
    return """
        SELECT invoice_requests.id, invoice_requests.status,
               invoice_requests.provider_reference,
               invoice_requests.attempt_count,
               invoice_requests.created_at, invoice_requests.updated_at,
               orders.public_id AS order_public_id, orders.owner_kind,
               orders.account_user_id, orders.organization_id,
               orders.total_amount, orders.currency,
               COALESCE(account.ho_ten, account.ten_dang_nhap, account.email)
                   AS account_name,
               account.email AS account_email,
               organization.ten_to_chuc AS organization_name,
               transactions.id AS transaction_id,
               transactions.provider_transaction_id,
               transactions.status AS transaction_status,
               transactions.verified_paid_amount,
               transactions.provider_occurred_at,
               transactions.created_at AS transaction_created_at,
               provider.provider, provider.environment AS provider_environment
          FROM billing_invoice_requests invoice_requests
          JOIN billing_orders orders ON orders.id = invoice_requests.order_id
          JOIN payment_transactions transactions
            ON transactions.id = invoice_requests.payment_transaction_id
           AND transactions.order_id = orders.id
          LEFT JOIN tai_khoan account ON account.id = orders.account_user_id
          LEFT JOIN to_chuc organization ON organization.id = orders.organization_id
          LEFT JOIN payment_provider_profiles provider
            ON provider.id = orders.provider_profile_id
    """


def _invoice_request_item(row):
    owner_id = (
        row["account_user_id"]
        if row["owner_kind"] == "account"
        else row["organization_id"]
    )
    owner_name = (
        row["account_name"]
        if row["owner_kind"] == "account"
        else row["organization_name"]
    )
    return {
        "id": row["id"],
        "status": row["status"],
        "owner": {
            "kind": row["owner_kind"],
            "id": owner_id,
            "name": owner_name,
            "email": row["account_email"] if row["owner_kind"] == "account" else None,
        },
        "orderPublicId": row["order_public_id"],
        "amounts": {
            "orderTotalMinor": int(row["total_amount"]),
            "verifiedPaidMinor": int(row["verified_paid_amount"]),
            "currency": row["currency"],
        },
        "paymentTransaction": {
            "id": row["transaction_id"],
            "providerTransactionId": row["provider_transaction_id"],
            "status": row["transaction_status"],
            "providerOccurredAt": _json_value(row["provider_occurred_at"]),
            "createdAt": _json_value(row["transaction_created_at"]),
        },
        "provider": {
            "name": row["provider"],
            "environment": row["provider_environment"],
            "invoiceReference": row["provider_reference"],
        },
        "attemptCount": int(row["attempt_count"]),
        "createdAt": _json_value(row["created_at"]),
        "updatedAt": _json_value(row["updated_at"]),
        "documentAvailable": False,
    }


def _list_admin_invoice_requests_sync(request):
    denied, _role = _forbidden_or_role(request)
    if denied:
        return denied
    try:
        page, page_size, search, sort_by, sort_direction = _parse_common_query(
            request,
            sort_columns=_INVOICE_SORT_COLUMNS,
            default_sort="created_at",
            allowed_filters={"ownerKind", "status"},
        )
        if "sortDir" not in request.query_params:
            sort_direction = "desc"
        owner_kind = str(request.query_params.get("ownerKind") or "").strip().lower()
        status = str(request.query_params.get("status") or "").strip().lower()
        if owner_kind not in _OWNER_KINDS:
            raise _InvalidDirectoryQuery("Loại chủ thể không hợp lệ.")
        if status not in _INVOICE_STATUSES:
            raise _InvalidDirectoryQuery("Trạng thái yêu cầu hóa đơn không hợp lệ.")

        predicates = []
        values = []
        if search:
            term = f"%{search.lower()}%"
            predicates.append(
                "(lower(invoice_requests.id) LIKE ? "
                "OR lower(orders.public_id) LIKE ? "
                "OR lower(COALESCE(invoice_requests.provider_reference, '')) LIKE ? "
                "OR lower(transactions.provider_transaction_id) LIKE ? "
                "OR lower(COALESCE(account.ho_ten, account.email, '')) LIKE ? "
                "OR lower(COALESCE(organization.ten_to_chuc, '')) LIKE ?)"
            )
            values.extend((term, term, term, term, term, term))
        if owner_kind:
            predicates.append("orders.owner_kind = ?")
            values.append(owner_kind)
        if status:
            predicates.append("invoice_requests.status = ?")
            values.append(status)
        where_sql = f" WHERE {' AND '.join(predicates)}" if predicates else ""
        select_sql = _invoice_request_select_sql()

        connection = database.get_connection()
        try:
            cursor = connection.cursor()
            cursor.execute(
                f"""SELECT COUNT(*) AS total_rows
                       FROM billing_invoice_requests invoice_requests
                       JOIN billing_orders orders ON orders.id = invoice_requests.order_id
                       JOIN payment_transactions transactions
                         ON transactions.id = invoice_requests.payment_transaction_id
                        AND transactions.order_id = orders.id
                       LEFT JOIN tai_khoan account ON account.id = orders.account_user_id
                       LEFT JOIN to_chuc organization ON organization.id = orders.organization_id
                       {where_sql}""",
                tuple(values),
            )
            total_rows = int(cursor.fetchone()["total_rows"])
            cursor.execute(
                f"""{select_sql}{where_sql}
                     ORDER BY {_INVOICE_SORT_COLUMNS[sort_by]} {sort_direction.upper()},
                              invoice_requests.id
                     LIMIT ? OFFSET ?""",
                (*values, page_size, (page - 1) * page_size),
            )
            rows = cursor.fetchall()
        finally:
            connection.close()

        return JSONResponse(
            {
                "items": [_invoice_request_item(row) for row in rows],
                "pagination": _pagination(page, page_size, total_rows),
                "sort": {"by": sort_by, "direction": sort_direction},
                "filters": {
                    "search": search,
                    "ownerKind": owner_kind,
                    "status": status,
                },
                "resource": "invoice_request",
            },
            headers={"Cache-Control": "private, no-store"},
        )
    except _InvalidDirectoryQuery as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001 - keep database details private.
        log_error(exc, "list_platform_admin_invoice_requests")
        return JSONResponse(
            {"error": "Đã xảy ra lỗi tải danh sách yêu cầu hóa đơn."},
            status_code=500,
        )


async def list_admin_invoice_requests_api(request):
    try:
        return await run_database_read(_list_admin_invoice_requests_sync, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = JSONResponse(
            {"error": "Hệ thống đang bận. Vui lòng thử lại sau."}, status_code=503
        )
        response.headers["Retry-After"] = "1"
        return response


def _get_admin_invoice_request_sync(request):
    denied, _role = _forbidden_or_role(request)
    if denied:
        return denied
    try:
        invoice_request_id = _bounded_identifier(
            request.path_params.get("invoice_request_id"), "Yêu cầu hóa đơn"
        )
        if not invoice_request_id:
            raise _InvalidDirectoryQuery("Yêu cầu hóa đơn không hợp lệ.")
        connection = database.get_connection()
        try:
            cursor = connection.cursor()
            cursor.execute(
                f"""{_invoice_request_select_sql()}
                     WHERE invoice_requests.id = ?
                     LIMIT 1""",
                (invoice_request_id,),
            )
            row = cursor.fetchone()
        finally:
            connection.close()
        if row is None:
            return JSONResponse(
                {"error": "Không tìm thấy yêu cầu hóa đơn."}, status_code=404
            )
        return JSONResponse(
            {
                "invoiceRequest": _invoice_request_item(row),
                "resource": "invoice_request",
                "notice": (
                    "Đây là dữ liệu yêu cầu phát hành hóa đơn; hệ thống chưa có "
                    "mô hình tài liệu hóa đơn để tải xuống."
                ),
            },
            headers={"Cache-Control": "private, no-store"},
        )
    except _InvalidDirectoryQuery as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)
    except Exception as exc:  # noqa: BLE001 - keep database details private.
        log_error(exc, "get_platform_admin_invoice_request")
        return JSONResponse(
            {"error": "Đã xảy ra lỗi tải yêu cầu hóa đơn."}, status_code=500
        )


async def get_admin_invoice_request_api(request):
    try:
        return await run_database_read(_get_admin_invoice_request_sync, request)
    except (BlockingIOBusyError, BlockingIOTimeoutError):
        response = JSONResponse(
            {"error": "Hệ thống đang bận. Vui lòng thử lại sau."}, status_code=503
        )
        response.headers["Retry-After"] = "1"
        return response


def platform_admin_billing_routes(Route):
    return [
        Route("/api/admin/subscriptions", list_admin_subscriptions_api, methods=["GET"]),
        Route("/api/admin/payments", list_admin_payments_api, methods=["GET"]),
        Route("/api/admin/invoices", list_admin_invoice_requests_api, methods=["GET"]),
        Route(
            "/api/admin/invoices/{invoice_request_id}",
            get_admin_invoice_request_api,
            methods=["GET"],
        ),
    ]
