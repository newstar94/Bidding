import os
import json
import secrets
from datetime import datetime
from starlette.responses import StreamingResponse, JSONResponse

from helpers import (
    database,
    verify_session,
    clean_id,
    VietnameseFloat,
    SCHEMA_DINH_NGHIA,
    to_camel_case,
    get_active_org,
    load_base64_image,
    OrgPermissionError
)

import custom_exporter

async def export_report_api(request):
    package_id = clean_id(request.path_params.get('package_id'))
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        conn = database.get_connection()
        cursor = conn.cursor()
        
        org_name = get_active_org(request, user_id)

        cursor.execute("SELECT * FROM goi_thau WHERE id = ? AND owner_id = ?", (package_id, org_name))
        row = cursor.fetchone()
        if not row:
            conn.close()
            return JSONResponse({"error": f"Package with id {package_id} not found"}, status_code=404)
        pkg = dict(row)
        
        cursor.execute("SELECT * FROM ke_hoach_lcnt WHERE id = ? AND owner_id = ?", (pkg['ke_hoach_id'], org_name))
        row_plan = cursor.fetchone()
        if not row_plan:
            conn.close()
            return JSONResponse({"error": f"Plan linked to package not found"}, status_code=404)
        plan = dict(row_plan)
        
        investor_name = '--'
        investor_address = ''
        if plan.get('chu_dau_tu_id'):
            cursor.execute("SELECT * FROM chu_dau_tu WHERE id = ?", (plan['chu_dau_tu_id'],))
            row_inv = cursor.fetchone()
            if row_inv:
                inv_data = dict(row_inv)
                investor_name = inv_data.get('ten_chu_dau_tu', '--')
                investor_address = inv_data.get('dia_chi', '')
                
        # Đọc tổ chuyên gia và tổ thẩm định từ bảng quan hệ goi_thau_chuyen_gia (nguồn chính thức)
        cursor.execute("""
            SELECT cg.*, gtcg.chuc_vu, gtcg.cong_viec, gtcg.loai
            FROM chuyen_gia cg
            JOIN goi_thau_chuyen_gia gtcg ON cg.id = gtcg.chuyen_gia_id
            WHERE gtcg.goi_thau_id = ?
            ORDER BY gtcg.loai, gtcg.rowid
        """, (package_id,))
        
        chuyen_gia_list = []
        tham_dinh_list = []
        expert_ids = []
        for row_rel in cursor.fetchall():
            member = dict(row_rel)
            loai = member.pop('loai', '')
            if loai == 'chuyen_gia':
                chuyen_gia_list.append(member)
                expert_ids.append(str(member.get('id', '')))
            elif loai == 'tham_dinh':
                tham_dinh_list.append(member)
                
        awarded_id = pkg.get('nha_thau_trung_thau_id')
        if not awarded_id and pkg.get('trang_thai') == 'Đã có kết quả':
            cursor.execute("""
                SELECT nha_thau_id FROM thong_tin_mo_thau 
                WHERE goi_thau_id = ? 
                  AND (danh_gia_ket_luan = 'Đạt' 
                       OR (danh_gia_hop_le = 'Đạt' AND danh_gia_nang_luc = 'Đạt' AND (danh_gia_ky_thuat = 'Đạt' OR danh_gia_ky_thuat = '')))
                LIMIT 1
            """, (package_id,))
            healed_row = cursor.fetchone()
            if healed_row:
                awarded_id = healed_row[0]
            else:
                cursor.execute("SELECT nha_thau_id FROM thong_tin_mo_thau WHERE goi_thau_id = ? LIMIT 1", (package_id,))
                healed_row = cursor.fetchone()
                if healed_row:
                    awarded_id = healed_row[0]

        nha_thau_list = []
        if awarded_id:
            cursor.execute("SELECT * FROM nha_thau WHERE id = ?", (awarded_id,))
            row_nt = cursor.fetchone()
            if row_nt:
                nt = dict(row_nt)
                
                cursor.execute(
                    "SELECT ten_nha_thau, loai_nha_thau, thanh_vien_lien_danh FROM thong_tin_mo_thau WHERE goi_thau_id = ? AND nha_thau_id = ?",
                    (pkg['id'], awarded_id)
                )
                row_mt = cursor.fetchone()
                
                nt_name = nt['ten_nha_thau']
                nt_type = nt.get('loai_nha_thau', 'Độc lập')
                members_parsed = []
                
                if row_mt:
                    mt_data = dict(row_mt)
                    if mt_data.get('ten_nha_thau'):
                        nt_name = mt_data['ten_nha_thau']
                    if mt_data.get('loai_nha_thau'):
                        nt_type = mt_data['loai_nha_thau']
                    if mt_data.get('thanh_vien_lien_danh'):
                        try:
                            members_parsed = json.loads(mt_data['thanh_vien_lien_danh'])
                        except Exception:
                            members_parsed = []
                else:
                    if nt.get('loai_nha_thau') == "Liên danh" and nt.get('thanh_vien_lien_danh'):
                        try:
                            members_parsed = json.loads(nt['thanh_vien_lien_danh'])
                        except Exception:
                            members_parsed = [nt['thanh_vien_lien_danh']]
                
                nt['ten_nha_thau'] = nt_name
                nt['loai_nha_thau'] = nt_type
                nt['members'] = members_parsed
                nt['awarded_price'] = pkg.get('gia_goi_thau', 0)
                nha_thau_list.append(nt)
        
        cursor.execute("""
            SELECT hd.* FROM hop_dong hd
            INNER JOIN hop_dong_goi_thau hdgt ON hd.id = hdgt.hop_dong_id
            WHERE hdgt.goi_thau_id = ? AND hd.owner_id = ?
        """, (package_id, org_name))
        row_hd = cursor.fetchone()
        contract_data = dict(row_hd) if row_hd else {}

        first_expert_data = {}
        if expert_ids:
            cursor.execute("SELECT * FROM chuyen_gia WHERE id = ?", (expert_ids[0],))
            row_cg = cursor.fetchone()
            if row_cg:
                first_expert_data = dict(row_cg)
                
        mt_data = {}
        if awarded_id:
            cursor.execute(
                "SELECT * FROM thong_tin_mo_thau WHERE goi_thau_id = ? AND nha_thau_id = ?",
                (package_id, awarded_id)
            )
            row_mt = cursor.fetchone()
            if row_mt:
                mt_data = dict(row_mt)

        cursor.execute("SELECT * FROM tai_khoan WHERE id = ?", (user_id,))
        row_user = cursor.fetchone()
        user_data = dict(row_user) if row_user else {}
        
        cursor.execute("SELECT * FROM to_chuc WHERE ten_to_chuc = ?", (org_name,))
        row_org = cursor.fetchone()
        org_data = dict(row_org) if row_org else {}
        
        gdv_data = {}
        if user_data.get('goi_dich_vu_id'):
            cursor.execute("SELECT * FROM goi_dich_vu WHERE id = ?", (user_data['goi_dich_vu_id'],))
            row_gdv = cursor.fetchone()
            if row_gdv:
                gdv_data = dict(row_gdv)

        cursor.execute("SELECT ten_bien, source_table, source_column FROM cau_hinh_bien_word WHERE owner_id = ?", (org_name,))
        mappings_rows = cursor.fetchall()
        
        row_by_table = {
            'chu_dau_tu': inv_data if 'inv_data' in locals() else {},
            'ke_hoach_lcnt': plan,
            'goi_thau': pkg,
            'nha_thau': nt if (awarded_id and 'nt' in locals()) else {},
            'hop_dong': contract_data,
            'chuyen_gia': first_expert_data,
            'thong_tin_mo_thau': mt_data,
            'mo_thau': mt_data,
            'tai_khoan': user_data,
            'to_chuc': org_data,
            'goi_dich_vu': gdv_data
        }
        
        custom_vars_list = []
        custom_evaluated_values = {}
        for m_row in mappings_rows:
            ten_bien = m_row[0].lower()
            src_table = m_row[1]
            src_column = m_row[2]
            
            custom_vars_list.append(ten_bien)
            
            tbl_data = row_by_table.get(src_table, {})
            val = tbl_data.get(src_column)
            if src_table == 'goi_thau' and src_column in ['gia_han_list', 'yeu_cau_lam_ro_list', 'tra_loi_lam_ro_list'] and val:
                try:
                    parsed_list = json.loads(val) if isinstance(val, str) else val
                    if isinstance(parsed_list, list):
                        formatted_items = []
                        for idx, item in enumerate(parsed_list):
                            if src_column == 'gia_han_list':
                                tg = item.get('thoiGianDongThau', '')
                                ld = item.get('lyDoGiaHan', '')
                                formatted_items.append(f'Lần {idx+1}: Gia hạn đến {tg} (Lý do: {ld})')
                            elif src_column == 'yeu_cau_lam_ro_list':
                                tg = item.get('thoiGianYeuCau', '')
                                nd = item.get('noiDungYeuCau', '')
                                formatted_items.append(f'Lần {idx+1}: Yêu cầu làm rõ lúc {tg} (Nội dung: {nd})')
                            elif src_column == 'tra_loi_lam_ro_list':
                                tg = item.get('thoiGianTraLoi', '')
                                nd = item.get('noiDungTraLoi', '')
                                formatted_items.append(f'Lần {idx+1}: Trả lời làm rõ lúc {tg} (Nội dung: {nd})')
                        val = '\n'.join(formatted_items) if formatted_items else '--'
                except Exception:
                    pass

            if val is None:
                val = '--'
            elif isinstance(val, (int, float)) and ('gia' in src_column or 'tong_muc' in src_column or 'gia_tri' in src_column):
                val = f'{VietnameseFloat(val)}'
            elif isinstance(val, (int, float)):
                val = str(val)
            else:
                val = str(val)

            custom_evaluated_values[ten_bien] = val

        conn.close()

        context = {
            'chuyen_gia': chuyen_gia_list,
            'tham_dinh': tham_dinh_list,
            'nha_thau': nha_thau_list
        }

        for key_name in ['gia_han_list', 'yeu_cau_lam_ro_list', 'tra_loi_lam_ro_list']:
            try:
                raw_val = pkg.get(key_name)
                context[key_name] = json.loads(raw_val) if isinstance(raw_val, str) else (raw_val or [])
            except:
                context[key_name] = []
        active_tpl = custom_exporter.get_active_template(user_id)
        if request.query_params.get('type') == 'contract':
            active_tpl = 'mau_hop_dong_lcnt.docx'
            
        custom_context = {}
        
        custom_context['Danh_Sach_Chuyen_Gia'] = []
        for idx, cg in enumerate(chuyen_gia_list):
            item = {'STT': idx + 1}
            for k, v in cg.items():
                item[k.lower()] = v
            for m_row in mappings_rows:
                ten_bien = m_row[0].lower()
                src_table = m_row[1]
                src_column = m_row[2]
                if src_table == 'chuyen_gia':
                    val = cg.get(src_column)
                    if val is None:
                        val = '--'
                    elif isinstance(val, (int, float)):
                        val = str(val)
                    else:
                        val = str(val)
                    item[ten_bien] = val
            custom_context['Danh_Sach_Chuyen_Gia'].append(item)
            
        custom_context['Danh_Sach_Tham_Dinh'] = []
        for idx, td in enumerate(tham_dinh_list):
            item = {'STT': idx + 1}
            for k, v in td.items():
                item[k.lower()] = v
            for m_row in mappings_rows:
                ten_bien = m_row[0].lower()
                src_table = m_row[1]
                src_column = m_row[2]
                if src_table == 'chuyen_gia':
                    val = td.get(src_column)
                    if val is None:
                        val = '--'
                    elif isinstance(val, (int, float)):
                        val = str(val)
                    else:
                        val = str(val)
                    item[ten_bien] = val
            custom_context['Danh_Sach_Tham_Dinh'].append(item)
            
        custom_context['Danh_Sach_Nha_Thau'] = []
        for idx, nt in enumerate(nha_thau_list):
            item = {'STT': idx + 1}
            for k, v in nt.items():
                item[k.lower()] = v
            for m_row in mappings_rows:
                ten_bien = m_row[0].lower()
                src_table = m_row[1]
                src_column = m_row[2]
                if src_table == 'nha_thau':
                    val = nt.get(src_column)
                    if val is None:
                        val = '--'
                    elif isinstance(val, (int, float)):
                        val = str(val)
                    else:
                        val = str(val)
                    item[ten_bien] = val
            custom_context['Danh_Sach_Nha_Thau'].append(item)

        custom_context['Danh_Sach_Phan_Lo'] = []
        try:
            pl_list = json.loads(pkg.get('phan_lo_list') or '[]')
            nt_name_map = {str(nt.get('id', '')): nt.get('ten_nha_thau', '--') for nt in nha_thau_list}
            for idx, pl in enumerate(pl_list):
                nt_id = pl.get('nhaThauTrungThauId')
                nt_name = nt_name_map.get(str(nt_id or ''), pl.get('nhaThauTrungThauName', '--'))
                if nt_name == '--' and pl.get('tenNhaThau'):
                    nt_name = pl.get('tenNhaThau')
                
                raw_val = pl.get('giaTrungThau') or pl.get('giaTriPhanLo') or 0
                
                custom_context['Danh_Sach_Phan_Lo'].append({
                    'STT': idx + 1,
                    'Ten_Phan_Lo': pl.get('tenPhanLo', '--'),
                    'Gia_Tri_Phan_Lo': f"{VietnameseFloat(raw_val)}" if raw_val else '0',
                    'Nha_Thau_Trung': nt_name,
                    'Thoi_Gian_Thuc_Hien': pl.get('thoiGianHopDong') or pl.get('thoiGianThucHien') or '--'
                })
        except Exception:
            pass

        custom_context['Danh_Sach_Tuy_Chon_Mua_Them'] = []
        try:
            tc_list = json.loads(pkg.get('tuy_chon_mua_them_list') or '[]')
            for idx, tc in enumerate(tc_list):
                custom_context['Danh_Sach_Tuy_Chon_Mua_Them'].append({
                    'STT': idx + 1,
                    'Hang_Muc': tc.get('hangMuc', '--'),
                    'Don_Vi': tc.get('donVi', '--'),
                    'So_Luong': str(tc.get('soLuong', 0)),
                    'Ty_Le': str(tc.get('tyLe', 0)),
                    'Gia_Tri_Uoc_Tinh': f"{VietnameseFloat(tc.get('giaTriUocTinh', 0))}" if tc.get('giaTriUocTinh') else '0'
                })
        except Exception:
            pass
            
        custom_context['Danh_Sach_Nha_Thau_Truot'] = []
        try:
            winning_ids = set()
            if awarded_id:
                winning_ids.add(str(awarded_id))
            
            if pkg.get('phan_lo') == 'Có':
                try:
                    pl_list = json.loads(pkg.get('phan_lo_list') or '[]')
                    for pl in pl_list:
                        nt_id = pl.get('nhaThauTrungThauId')
                        if nt_id:
                            winning_ids.add(str(nt_id))
                except Exception:
                    pass

            cursor.execute("SELECT * FROM thong_tin_mo_thau WHERE goi_thau_id = ?", (package_id,))
            all_bids = [dict(r) for r in cursor.fetchall()]
            
            bids_by_nt = {}
            for bid in all_bids:
                nt_id = str(bid.get('nha_thau_id') or '')
                if not nt_id:
                    continue
                if nt_id not in bids_by_nt:
                    bids_by_nt[nt_id] = []
                bids_by_nt[nt_id].append(bid)

            idx_truot = 1
            for nt_id, nt_bids in bids_by_nt.items():
                if nt_id in winning_ids:
                    continue
                
                lot_reasons = []
                for bid in nt_bids:
                    ly_do = bid.get('ly_do_truot') or ''
                    if not ly_do:
                        ket_luan = bid.get('danh_gia_ket_luan')
                        if ket_luan == 'Không đạt':
                            failed_steps = []
                            if bid.get('danh_gia_hop_le') == 'Không đạt':
                                failed_steps.append("Đánh giá hợp lệ")
                            if bid.get('danh_gia_nang_luc') == 'Không đạt':
                                failed_steps.append("Đánh giá năng lực")
                            if bid.get('danh_gia_ky_thuat') == 'Không đạt' or (bid.get('danh_gia_ky_thuat') and 'không đạt' in str(bid.get('danh_gia_ky_thuat')).lower()):
                                failed_steps.append("Đánh giá kỹ thuật")
                            if bid.get('danh_gia_tai_chinh') == 'Không đạt' or (bid.get('danh_gia_tai_chinh') and 'không đạt' in str(bid.get('danh_gia_tai_chinh')).lower()):
                                failed_steps.append("Đánh giá tài chính")
                            
                            if failed_steps:
                                ly_do = f"Không đạt ở bước: {', '.join(failed_steps)}"
                            else:
                                ly_do = "Không đạt đánh giá chi tiết"
                        else:
                            ly_do = "Đạt yêu cầu kỹ thuật nhưng giá dự thầu xếp sau"
                    
                    if pkg.get('phan_lo') == 'Có' and (bid.get('ten_phan_lo') or bid.get('ma_phan_lo')):
                        ten_lo = bid.get('ten_phan_lo') or bid.get('ma_phan_lo')
                        lot_reasons.append(f"{ten_lo}: {ly_do}")
                    else:
                        lot_reasons.append(ly_do)
                
                tong_hop_ly_do = "; ".join(lot_reasons)
                first_bid = nt_bids[0]
                custom_context['Danh_Sach_Nha_Thau_Truot'].append({
                    'STT': idx_truot,
                    'Ten_Nha_Thau': first_bid.get('ten_nha_thau') or '--',
                    'Ma_Nha_Thau': first_bid.get('ma_dinh_danh') or first_bid.get('ma_phan_lo') or '--',
                    'Ly_Do_Truot': tong_hop_ly_do
                })
                idx_truot += 1
        except Exception as e:
            print("Error preparing Danh_Sach_Nha_Thau_Truot:", e)
            
        winning_nt = nha_thau_list[0] if nha_thau_list else {}
        custom_context['Thanh_Vien_Lien_Danh'] = []
        members = winning_nt.get('members', []) or []
        for idx, m in enumerate(members):
            role = "Liên danh phụ (Thành viên)"
            if idx == 0:
                role = "Liên danh chính (Đứng đầu liên danh)"
            custom_context['Thanh_Vien_Lien_Danh'].append({
                'STT': idx + 1,
                'Ten_TV': m.get('tenNhaThau') or m.get('ten_tv') or m.get('name') or '--',
                'MST_TV': m.get('maSoThue') or m.get('mst_tv') or m.get('tax_code') or '--',
                'Vai_Tro_TV': m.get('vaiTro') or m.get('vai_tro_tv') or role,
                'Nguoi_Dai_Dien_TV': m.get('nguoiDaiDien') or m.get('representative') or '--',
                'Dia_Chi_TV': m.get('diaChi') or m.get('address') or '--',
                'So_Tai_Khoan_TV': m.get('soTaiKhoan') or m.get('so_tai_khoan') or '--',
                'Noi_Mo_Tai_Khoan_TV': m.get('noiMoTaiKhoan') or m.get('noi_mo_tai_khoan') or '--',
            })
        
        unified_context = {}
        unified_context.update(context)
        unified_context.update(custom_context)
        unified_context['mo_thau'] = mt_data
        for k, v in custom_evaluated_values.items():
            unified_context[k] = v

        if active_tpl == 'mau_bao_cao_dau_thau.docx':
            tpl_path = os.path.join(custom_exporter.TEMPLATE_DIR, active_tpl)
        elif active_tpl == 'mau_hop_dong_lcnt.docx':
            tpl_path = os.path.join(custom_exporter.TEMPLATE_DIR, active_tpl)
        else:
            user_dir = custom_exporter.get_user_template_dir(user_id)
            tpl_path = os.path.join(user_dir, active_tpl)
            
        docx_stream = custom_exporter.generate_report_from_custom_template(tpl_path, unified_context, custom_vars_list)
        
        return StreamingResponse(
            docx_stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f"attachment; filename=Bao_cao_danh_gia_goi_thau_{pkg['ma_goi_thau']}.docx"}
        )
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"error": str(e)}, status_code=500)

async def list_templates_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        templates = custom_exporter.list_templates(user_id)
        return JSONResponse(templates)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def set_active_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id
        
        data = await request.json()
        filename = data.get('filename')
        if not filename:
            return JSONResponse({"error": "Filename is required"}, status_code=400)
        custom_exporter.set_active_template(filename, user_id)
        return JSONResponse({"status": "success"})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def upload_template_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        user_id = role_or_err.user_id

        form = await request.form()
        file_obj = form.get('file')
        if not file_obj:
            return JSONResponse({"error": "No file uploaded"}, status_code=400)
        
        # Làm sạch tên file để tránh lỗi Path Traversal
        filename = os.path.basename(file_obj.filename)
        # Chỉ cho phép các định dạng tệp .docx và .doc
        _, ext = os.path.splitext(filename.lower())
        if ext not in ['.docx', '.doc']:
            return JSONResponse({"success": False, "error": "Chỉ cho phép tải lên tệp tin định dạng .docx hoặc .doc!"}, status_code=400)

        file_bytes = await file_obj.read()
        valid, msg = custom_exporter.validate_template_syntax(file_bytes)
        
        if not valid:
            return JSONResponse({"success": False, "error": msg}, status_code=200)
        
        user_dir = custom_exporter.get_user_template_dir(user_id)
        save_path = os.path.join(user_dir, filename)
        with open(save_path, 'wb') as f:
            f.write(file_bytes)
            
        custom_exporter.set_active_template(filename, user_id)
        return JSONResponse({"success": True, "message": "Tải biểu mẫu lên thành công và đã được kích hoạt!"})
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

async def list_word_mappings_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        org_name = get_active_org(request, role_or_err.user_id)
        
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, ten_bien, source_table, source_column FROM cau_hinh_bien_word WHERE owner_id = ?", (org_name,))
        rows = cursor.fetchall()
        conn.close()
        
        mappings = []
        for r in rows:
            mappings.append({
                "id": r[0],
                "tenBien": r[1],
                "sourceTable": r[2],
                "sourceColumn": r[3]
            })
        return JSONResponse(mappings)
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def save_word_mapping_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        org_name = get_active_org(request, role_or_err.user_id)
        
        data = await request.json()
        m_id = data.get('id')
        ten_bien = data.get('tenBien', '').strip().lower()
        source_table = data.get('sourceTable', '').strip()
        source_column = data.get('sourceColumn', '').strip()
        
        if not ten_bien or not source_table or not source_column:
            return JSONResponse({"error": "Vui lòng nhập đầy đủ thông tin!"}, status_code=400)
            
        import re
        if not re.match(r'^[A-Za-z0-9_]+$', ten_bien):
            return JSONResponse({"error": "Tên biến chỉ được chứa chữ cái, chữ số và dấu gạch dưới!"}, status_code=400)
            
        if not m_id:
            m_id = "wm-" + secrets.token_hex(8)
            
        current_time = int(datetime.utcnow().timestamp())
        
        conn = database.get_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("""
                INSERT OR REPLACE INTO cau_hinh_bien_word (id, owner_id, ten_bien, source_table, source_column, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (m_id, org_name, ten_bien, source_table, source_column, current_time))
            conn.commit()
        except Exception as db_err:
            conn.close()
            if "UNIQUE" in str(db_err) or "constraint failed" in str(db_err):
                return JSONResponse({"error": f"Tên biến '{ten_bien}' đã tồn tại trong hệ thống của bạn!"}, status_code=400)
            return JSONResponse({"error": str(db_err)}, status_code=500)
        conn.close()
        
        return JSONResponse({"success": True, "id": m_id})
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

async def delete_word_mapping_api(request):
    try:
        is_valid, role_or_err = verify_session(request)
        if not is_valid:
            return JSONResponse({"error": role_or_err}, status_code=403)
        org_name = get_active_org(request, role_or_err.user_id)
        
        mapping_id = request.path_params.get('mapping_id')
        
        conn = database.get_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM cau_hinh_bien_word WHERE id = ? AND owner_id = ?", (mapping_id, org_name))
        conn.commit()
        conn.close()
        
        return JSONResponse({"success": True})
    except OrgPermissionError as e:
        return JSONResponse({"error": str(e)}, status_code=403)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
