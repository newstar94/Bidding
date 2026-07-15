"""Apply configured Word field and list mappings to an export context."""

from backend.shared.helpers import VietnameseFloat


CONTEXT_SOURCE_TABLE = "__context__"

def apply_custom_mappings(context, mappings_rows):
    table_to_context = {
        'ke_hoach_lcnt': ['ke_hoach'],
        'goi_thau': ['goi_thau', 'goi_thau_versions', 'goi_thau'],
        'nha_thau': ['nha_thau'],
        'chu_dau_tu': ['chu_dau_tu'],
        'hop_dong': ['hop_dong'],
        'tai_khoan': ['user'],
        'to_chuc': ['to_chuc'],
        'goi_dich_vu': ['goi_dich_vu']
    }


    def format_mapped_value(val, col_name):
        if val is None:
            return '--'
        if isinstance(val, (int, float)) and ('gia' in col_name or 'tong_muc' in col_name or 'gia_tri' in col_name or 'tong_tien' in col_name):
            try:
                return f'{VietnameseFloat(val)}'
            except (TypeError, ValueError, OverflowError):
                pass
        return val

    def apply_field_to_value(target, src_column, ten_bien):
        val_found = False
        resolved_val = None
        if isinstance(target, list):
            for item in target:
                found, value = apply_field_to_value(item, src_column, ten_bien)
                if found:
                    val_found = True
                    resolved_val = value
        elif isinstance(target, dict):
            if src_column in target and target.get(src_column) is not None:
                formatted = format_mapped_value(target.get(src_column), src_column)
                target[ten_bien] = formatted
                val_found = True
                resolved_val = formatted
            for child in target.values():
                if isinstance(child, (dict, list)):
                    found, value = apply_field_to_value(child, src_column, ten_bien)
                    if found:
                        val_found = True
                        resolved_val = value
        return val_found, resolved_val

    def apply_field_to_named_list(container, list_key, src_column, ten_bien):
        val_found = False
        resolved_val = None
        if isinstance(container, dict):
            if list_key in container and isinstance(container[list_key], list):
                found, value = apply_field_to_value(container[list_key], src_column, ten_bien)
                if found:
                    val_found = True
                    resolved_val = value
            for child in container.values():
                if isinstance(child, (dict, list)):
                    found, value = apply_field_to_named_list(child, list_key, src_column, ten_bien)
                    if found:
                        val_found = True
                        resolved_val = value
        elif isinstance(container, list):
            for item in container:
                found, value = apply_field_to_named_list(item, list_key, src_column, ten_bien)
                if found:
                    val_found = True
                    resolved_val = value
        return val_found, resolved_val


    for ten_bien, src_table, src_column in mappings_rows:
        ten_bien = ten_bien.lower()
        if not src_column or src_column == '*' or src_column == '':
            ctx_keys = table_to_context.get(src_table, [])
            if ctx_keys:
                for key in ctx_keys:
                    if key in context and isinstance(context[key], list):
                        context[ten_bien] = [dict(item) for item in context[key]]
                        break
                    elif key in context and isinstance(context[key], dict):
                        context[ten_bien] = [dict(context[key])]
                        break
            else:

                found = False
                if src_table in context and isinstance(context[src_table], list):
                    context[ten_bien] = list(context[src_table])
                    found = True
                if not found:
                    for ctx_val in context.values():
                        if isinstance(ctx_val, dict) and src_table in ctx_val:
                            val = ctx_val[src_table]
                            if isinstance(val, list):
                                context[ten_bien] = list(val)
                                found = True
                                break
                        elif isinstance(ctx_val, list):
                            for item in ctx_val:
                                if isinstance(item, dict) and src_table in item:
                                    val = item[src_table]
                                    if isinstance(val, list):
                                        context[ten_bien] = list(val)
                                        found = True
                                        break
                            if found:
                                break


    for ten_bien, src_table, src_column in mappings_rows:
        ten_bien = ten_bien.lower()
        if src_column and src_column != '*' and src_column != '':
            if src_table == CONTEXT_SOURCE_TABLE:
                if src_column in context:
                    context[ten_bien] = format_mapped_value(context.get(src_column), src_column)
                continue


            entity_keys = {
                'ke_hoach_lcnt': ['ke_hoach'],
                'goi_thau': ['goi_thau', 'goi_thau_versions'],
                'nha_thau': ['nha_thau', 'thong_tin_mo_thau', 'bids'],
                'thong_tin_mo_thau': ['nha_thau', 'thong_tin_mo_thau', 'bids'],
                'ds_nha_thau_tham_du': ['ds_nha_thau_tham_du'],
                'ds_nha_thau_trung_thau': ['ds_nha_thau_trung_thau'],
                'ds_nha_thau_truot_thau': ['ds_nha_thau_truot_thau'],
                'ds_nha_thau_khong_dat': ['ds_nha_thau_khong_dat'],
                'ds_nha_thau_dat_khong_xep_hang_1': ['ds_nha_thau_dat_khong_xep_hang_1'],
                'ds_nha_thau_khong_duoc_danh_gia': ['ds_nha_thau_khong_duoc_danh_gia'],
                'ds_nha_thau_trung_theo_phan_lo': ['ds_nha_thau_trung_theo_phan_lo'],
                'chuyen_gia': ['chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh'],
                'to_chuyen_gia': ['chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh'],
                'to_tham_dinh': ['chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh'],
                'yeu_cau_lam_ro': ['yeu_cau_lam_ro_list'],
                'yeu_cau_lam_ro_list': ['yeu_cau_lam_ro_list'],
                'tra_loi_lam_ro': ['tra_loi_lam_ro_list'],
                'tra_loi_lam_ro_list': ['tra_loi_lam_ro_list'],
                'phan_lo': ['phan_lo_list', 'awarded_phan_lo_list'],
                'phan_lo_list': ['phan_lo_list', 'awarded_phan_lo_list'],
                'awarded_phan_lo_list': ['phan_lo_list', 'awarded_phan_lo_list'],
                'ds_phan_lo': ['ds_phan_lo'],
                'ds_phan_lo_co_nha_thau_tham_du': ['ds_phan_lo_co_nha_thau_tham_du'],
                'ds_phan_lo_khong_co_nha_thau_tham_du': ['ds_phan_lo_khong_co_nha_thau_tham_du'],
                'ds_phan_lo_co_nha_thau_tham_du_khong_trung': ['ds_phan_lo_co_nha_thau_tham_du_khong_trung'],
                'ds_phan_lo_co_nha_thau_trung': ['ds_phan_lo_co_nha_thau_trung'],
                'tuy_chon_mua_them': ['tuy_chon_mua_them_list'],
                'tuy_chon_mua_them_list': ['tuy_chon_mua_them_list'],
                'gia_han': ['gia_han_list'],
                'gia_han_list': ['gia_han_list'],
                'thanh_vien_lien_danh': ['thanh_vien_lien_danh'],
                'cv_da_thuc_hien': ['cv_da_thuc_hien'],
                'cv_da_thuc_hien_list': ['cv_da_thuc_hien'],
                'cv_khong_ap_dung': ['cv_khong_ap_dung'],
                'cv_khong_ap_dung_list': ['cv_khong_ap_dung'],
                'cv_chua_du_dieu_kien': ['cv_chua_du_dieu_kien'],
                'cv_chua_du_dieu_kien_list': ['cv_chua_du_dieu_kien'],
                'chu_dau_tu': ['chu_dau_tu'],
                'hop_dong': ['hop_dong'],
                'tai_khoan': ['user'],
                'to_chuc': ['to_chuc'],
                'goi_dich_vu': ['goi_dich_vu']
            }

            primary_keys = entity_keys.get(src_table, [])
            if src_table in ('nha_thau', 'thong_tin_mo_thau'):
                primary_keys = list(set(entity_keys['nha_thau'] + entity_keys['thong_tin_mo_thau']))
            elif src_table in ('chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh'):
                primary_keys = list(set(entity_keys['chuyen_gia']))
            elif src_table in ('yeu_cau_lam_ro', 'yeu_cau_lam_ro_list'):
                primary_keys = ['yeu_cau_lam_ro_list']
            elif src_table in ('tra_loi_lam_ro', 'tra_loi_lam_ro_list'):
                primary_keys = ['tra_loi_lam_ro_list']
            elif src_table in ('phan_lo', 'phan_lo_list', 'awarded_phan_lo_list'):
                primary_keys = list(set(entity_keys['phan_lo']))
            elif src_table in ('tuy_chon_mua_them', 'tuy_chon_mua_them_list'):
                primary_keys = ['tuy_chon_mua_them_list']
            elif src_table in ('gia_han', 'gia_han_list'):
                primary_keys = ['gia_han_list']
            elif src_table == 'thanh_vien_lien_danh':
                primary_keys = ['thanh_vien_lien_danh']
            elif src_table in ('cv_da_thuc_hien', 'cv_da_thuc_hien_list'):
                primary_keys = ['cv_da_thuc_hien']
            elif src_table in ('cv_khong_ap_dung', 'cv_khong_ap_dung_list'):
                primary_keys = ['cv_khong_ap_dung']
            elif src_table in ('cv_chua_du_dieu_kien', 'cv_chua_du_dieu_kien_list'):
                primary_keys = ['cv_chua_du_dieu_kien']

            custom_lists = []
            for l_bien, l_table, l_col in mappings_rows:
                if not l_col or l_col == '*' or l_col == '':
                    is_match = (
                        (l_table == src_table)
                        or (src_table in ('nha_thau', 'thong_tin_mo_thau') and l_table in ('nha_thau', 'thong_tin_mo_thau'))
                        or (src_table in ('chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh') and l_table in ('chuyen_gia', 'to_chuyen_gia', 'to_tham_dinh'))
                        or (src_table in ('yeu_cau_lam_ro', 'yeu_cau_lam_ro_list') and l_table in ('yeu_cau_lam_ro', 'yeu_cau_lam_ro_list'))
                        or (src_table in ('tra_loi_lam_ro', 'tra_loi_lam_ro_list') and l_table in ('tra_loi_lam_ro', 'tra_loi_lam_ro_list'))
                        or (src_table in ('phan_lo', 'phan_lo_list', 'awarded_phan_lo_list') and l_table in ('phan_lo', 'phan_lo_list', 'awarded_phan_lo_list'))
                        or (src_table in ('tuy_chon_mua_them', 'tuy_chon_mua_them_list') and l_table in ('tuy_chon_mua_them', 'tuy_chon_mua_them_list'))
                        or (src_table in ('gia_han', 'gia_han_list') and l_table in ('gia_han', 'gia_han_list'))
                        or (src_table == 'thanh_vien_lien_danh' and l_table == 'thanh_vien_lien_danh')
                        or (src_table in ('cv_da_thuc_hien', 'cv_da_thuc_hien_list') and l_table in ('cv_da_thuc_hien', 'cv_da_thuc_hien_list'))
                        or (src_table in ('cv_khong_ap_dung', 'cv_khong_ap_dung_list') and l_table in ('cv_khong_ap_dung', 'cv_khong_ap_dung_list'))
                        or (src_table in ('cv_chua_du_dieu_kien', 'cv_chua_du_dieu_kien_list') and l_table in ('cv_chua_du_dieu_kien', 'cv_chua_du_dieu_kien_list'))
                    )
                    if is_match:
                        custom_lists.append(l_bien.lower())

            all_keys = list(set(primary_keys + custom_lists))

            val_found = False
            resolved_val = None

            for key in all_keys:
                if key in context:
                    found, value = apply_field_to_value(context[key], src_column, ten_bien)
                    if found:
                        resolved_val = value
                        val_found = True
                else:
                    for ctx_val in context.values():
                        found, value = apply_field_to_named_list(ctx_val, key, src_column, ten_bien)
                        if found:
                            resolved_val = value
                            val_found = True

            if val_found:
                context[ten_bien] = resolved_val
            else:

                if src_table == 'chu_dau_tu':
                    if src_column == 'ten_chu_dau_tu':
                        context[ten_bien] = context.get('investor_name', '--')
                    elif src_column == 'dia_chi':
                        context[ten_bien] = context.get('investor_address', '--')

