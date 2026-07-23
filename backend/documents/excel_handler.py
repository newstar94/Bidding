import pandas as pd
from io import BytesIO
import re
import hashlib

from backend.shared.numeric_utils import parse_vnd_amount

from .field_manifest import build_field_manifest
from .schema_contract import CLIENT_TABLE_MAP, json_key_for_column

ENTITY_SCHEMA = {
    'chudautu': [
        {'field': 'maChuDauTu',           'label': 'Mã chủ đầu tư',              'aliases': ['Mã chủ đầu tư', 'Mã CĐT', 'maChuDauTu']},
        {'field': 'tenChuDauTu',           'label': 'Tên chủ đầu tư',             'aliases': ['Tên chủ đầu tư', 'Tên CĐT', 'tenChuDauTu']},
        {'field': 'ngayApDung',            'label': 'Ngày áp dụng',               'aliases': ['Ngày áp dụng', 'ngayApDung']},
        {'field': 'tenVietTat',            'label': 'Tên viết tắt',                 'aliases': ['Tên viết tắt', 'Tên VT', 'Viết tắt', 'tenVietTat']},
        {'field': 'maSoThue',              'label': 'Mã số thuế',                  'aliases': ['Mã số thuế', 'MST', 'maSoThue']},
        {'field': 'chucVuNguoiDungDau',   'label': 'Chức vụ người đứng đầu',      'aliases': ['Chức vụ người đứng đầu', 'Chức vụ', 'chucVuNguoiDungDau']},
        {'field': 'daiDienCdt',           'label': 'Đại diện CĐT',                'aliases': ['Đại diện CĐT', 'Người ký QĐ', 'Người ký', 'daiDienCdt']},
        {'field': 'chucVuDaiDien',        'label': 'Chức vụ người đại diện',     'aliases': ['Chức vụ người đại diện', 'Chức vụ người ký', 'chucVuDaiDien']},
        {'field': 'danhXung',             'label': 'Danh xưng',                   'aliases': ['Danh xưng', 'Ông/Bà', 'danhXung'],
                                           'options': ['Ông', 'Bà']},
        {'field': 'diaChi',               'label': 'Địa chỉ trụ sở',              'aliases': ['Địa chỉ', 'Địa chỉ trụ sở', 'diaChi']},
        {'field': 'soDienThoai',          'label': 'Số điện thoại',               'aliases': ['Số điện thoại', 'SĐT', 'soDienThoai']},
        {'field': 'soTaiKhoan',           'label': 'Số tài khoản',               'aliases': ['Số tài khoản', 'STK', 'soTaiKhoan']},
        {'field': 'noiMoTaiKhoan',        'label': 'Nơi mở tài khoản',            'aliases': ['Nơi mở tài khoản', 'Ngân hàng', 'noiMoTaiKhoan']},
        {'field': 'email',                'label': 'Email',                       'aliases': ['Email', 'Địa chỉ email', 'email']},
        {'field': 'maQHNS',               'label': 'Mã QHNS',                    'aliases': ['Mã QHNS', 'maQHNS']},
        {'field': 'coQuanChuQuan',        'label': 'Cơ quan chủ quản',            'aliases': ['Cơ quan chủ quản', 'coQuanChuQuan']},
    ],
    'kehoach': [
        {'field': 'maKeHoach',            'label': 'Mã kế hoạch',                'aliases': ['Mã kế hoạch', 'maKeHoach']},
        {'field': 'maDuan',               'label': 'Mã dự án',                   'aliases': ['Mã dự án', 'maDuan']},
        {'field': 'tenKeHoach',           'label': 'Tên kế hoạch',               'aliases': ['Tên kế hoạch', 'tenKeHoach']},
        {'field': 'loaiHinhMuaSam',       'label': 'Loại hình',                   'aliases': ['Loại hình', 'Loại hình mua sắm', 'loaiHinhMuaSam'],
                                           'options': ['Dự án', 'Dự toán mua sắm']},
        {'field': 'tenDuAnDuToan',        'label': 'Tên dự án',                  'aliases': ['Tên dự án', 'Dự án', 'Dự án / Dự toán', 'tenDuAnDuToan']},
        {'field': 'chuDauTuId',           'label': 'Chủ đầu tư',                  'aliases': ['Chủ đầu tư', 'Mã chủ đầu tư', 'chuDauTuId']},
        {'field': 'donViTrinhCdt',        'label': 'Đơn vị trình của chủ đầu tư', 'aliases': ['Đơn vị trình của chủ đầu tư', 'Đơn vị trình CĐT', 'donViTrinhCdt']},
        {'field': 'tenVietTatDonViTrinh', 'label': 'Tên viết tắt đơn vị trình',   'aliases': ['Tên viết tắt đơn vị trình', 'Tên viết tắt ĐV trình', 'tenVietTatDonViTrinh']},
        {'field': 'tongMucDauTu',         'label': 'Tổng mức đầu tư',             'aliases': ['Tổng giá trị', 'Tổng mức đầu tư', 'tongMucDauTu']},
        {'field': 'ngayPheDuyet',         'label': 'Ngày phê duyệt',               'aliases': ['Ngày phê duyệt', 'ngayPheDuyet']},
        {'field': 'quyetDinhPheDuyet',    'label': 'Số QĐ',               'aliases': ['Số QĐ', 'QĐ phê duyệt', 'quyetDinhPheDuyet']},
        {'field': 'thoiGianDangMa',       'label': 'Thời gian đăng',               'aliases': ['Thời gian đăng', 'Thời gian đăng mã', 'thoiGianDangMa']},
        {'field': 'soQdPheDuyetDuAn',     'label': 'Số QĐ phê duyệt dự án',       'aliases': ['Số QĐ phê duyệt dự án', 'soQdPheDuyetDuAn']},
        {'field': 'ngayQdPheDuyetDuAn',   'label': 'Ngày QĐ phê duyệt dự án',     'aliases': ['Ngày QĐ phê duyệt dự án', 'ngayQdPheDuyetDuAn']},
        {'field': 'coQuanPheDuyetDuAn',   'label': 'Cơ quan phê duyệt dự án',     'aliases': ['Cơ quan phê duyệt dự án', 'coQuanPheDuyetDuAn']},
        {'field': 'pheDuyet',             'label': 'Phê duyệt',                   'aliases': ['Phê duyệt', 'Hình thức phê duyệt', 'pheDuyet'],
                                           'options': ['Kế hoạch', 'Dự toán và kế hoạch']},
        {'field': 'soToTrinhDuToan',      'label': 'Số tờ trình dự toán',         'aliases': ['Số tờ trình dự toán', 'Số TTr dự toán', 'soToTrinhDuToan']},
        {'field': 'ngayTrinhDuToan',      'label': 'Ngày trình dự toán',          'aliases': ['Ngày trình dự toán', 'ngayTrinhDuToan']},
        {'field': 'ngayPheDuyetDuToan',   'label': 'Ngày phê duyệt dự toán',      'aliases': ['Ngày phê duyệt dự toán', 'ngayPheDuyetDuToan']},
        {'field': 'soQdPheDuyetDuToan',   'label': 'Số QĐ phê duyệt dự toán',     'aliases': ['Số QĐ phê duyệt dự toán', 'soQdPheDuyetDuToan']},
        {'field': 'soToTrinhKeHoach',     'label': 'Số tờ trình kế hoạch',        'aliases': ['Số tờ trình kế hoạch', 'Số TTr kế hoạch', 'soToTrinhKeHoach']},
        {'field': 'soToTrinhDuToanKeHoach', 'label': 'Số tờ trình dự toán và kế hoạch', 'aliases': ['Số tờ trình dự toán và kế hoạch', 'Số TTr dự toán và kế hoạch', 'soToTrinhDuToanKeHoach']},
        {'field': 'ngayTrinhKeHoach',     'label': 'Ngày trình kế hoạch',         'aliases': ['Ngày trình kế hoạch', 'Ngày trình dự toán và kế hoạch', 'ngayTrinhKeHoach']},
        {'field': 'nguonVon',             'label': 'Nguồn vốn',                   'aliases': ['Nguồn vốn', 'nguonVon']},
        {'field': 'thoiGianDuAn',         'label': 'Thời gian dự án',             'aliases': ['Thời gian dự án', 'thoiGianDuAn']},
        {'field': 'diaDiemQuyMo',         'label': 'Địa điểm quy mô',             'aliases': ['Địa điểm quy mô', 'diaDiemQuyMo']},
        {'field': 'thongTinKhac',         'label': 'Thông tin khác',              'aliases': ['Thông tin khác', 'thongTinKhac']},
    ],
    'goithau': [
        {'field': 'maGoiThau',            'label': 'Mã gói thầu',                 'aliases': ['Mã gói thầu', 'maGoiThau']},
        {'field': 'tenGoiThau',           'label': 'Tên gói thầu',                'aliases': ['Tên gói thầu', 'tenGoiThau']},
        {'field': 'keHoachId',            'label': 'Kế hoạch',                    'aliases': ['Kế hoạch', 'Kế hoạch LCNT', 'keHoachId']},
        {'field': 'giaGoiThau',           'label': 'Giá gói thầu',               'aliases': ['Giá gói thầu', 'Giá gói', 'giaGoiThau']},
        {'field': 'hinhThucLuaChon',      'label': 'Hình thức',                   'aliases': ['Hình thức', 'Hình thức lựa chọn', 'hinhThucLuaChon'],
                                           'options': ['Đấu thầu rộng rãi', 'Đấu thầu hạn chế', 'Chỉ định thầu', 'Chỉ định thầu rút gọn', 'Chào hàng cạnh tranh', 'Lựa chọn nhà thầu trong trường hợp đặc biệt']},
        {'field': 'phuongThucLuaChon',    'label': 'Phương thức',                 'aliases': ['Phương thức', 'Phương thức lựa chọn', 'phuongThucLuaChon'],
                                           'options': ['Một giai đoạn một túi hồ sơ', 'Một giai đoạn hai túi hồ sơ', 'Hai giai đoạn một túi hồ sơ', 'Hai giai đoạn hai túi hồ sơ', 'Không có']},
        {'field': 'thoiGianThucHien',     'label': 'Thời gian thực hiện',          'aliases': ['Thời gian thực hiện', 'Thời gian', 'thoiGianThucHien']},
        {'field': 'trangThai',            'label': 'Trạng thái',                   'aliases': ['Trạng thái', 'trangThai'],
                                           'options': ['Chuẩn bị', 'Đang mời thầu', 'Đã mở thầu', 'Đang chấm thầu', 'Đã có kết quả một phần', 'Đã có kết quả', 'Hủy thầu']},
        {'field': 'loaiHopDong',          'label': 'Loại hợp đồng',               'aliases': ['Loại hợp đồng', 'loaiHopDong'],
                                           'options': ['Trọn gói', 'Theo đơn giá cố định', 'Theo đơn giá điều chỉnh', 'Theo thời gian', 'Hợp đồng theo tỷ lệ phần trăm', 'Hợp đồng hỗn hợp']},
        {'field': 'nguonVon',             'label': 'Nguồn vốn',                   'aliases': ['Nguồn vốn', 'nguonVon']},
        {'field': 'linhVuc',              'label': 'Lĩnh vực',                    'aliases': ['Lĩnh vực', 'linhVuc'],
                                           'options': ['Tư vấn', 'Phi tư vấn', 'Xây lắp', 'Hỗn hợp', 'Hàng hóa']},
        {'field': 'tuyChonMuaThem',       'label': 'Tùy chọn mua thêm',           'aliases': ['Tùy chọn mua thêm', 'tuyChonMuaThem'],
                                           'options': ['Có', 'Không']},
        {'field': 'thoiGianToChuc',       'label': 'Thời gian tổ chức',            'aliases': ['Thời gian tổ chức', 'thoiGianToChuc']},
        {'field': 'thoiGianBatDauToChuc', 'label': 'Thời gian bắt đầu tổ chức',  'aliases': ['Thời gian bắt đầu tổ chức', 'thoiGianBatDauToChuc']},
        {'field': 'quaMang',              'label': 'Qua mạng / Trực tiếp',        'aliases': ['Qua mạng / Trực tiếp', 'Qua mạng', 'quaMang'],
                                           'options': ['Qua mạng', 'Trực tiếp']},
        {'field': 'trongNuocQuocTe',      'label': 'Trong nước / Quốc tế',       'aliases': ['Trong nước / Quốc tế', 'Trong nước', 'trongNuocQuocTe'],
                                           'options': ['Trong nước', 'Quốc tế']},
        {'field': 'phanLo',               'label': 'Phân lô / Không phân lô',     'aliases': ['Phân lô / Không phân lô', 'Phân lô', 'phanLo'],
                                           'options': ['Có', 'Không']},
        {'field': 'thoiGianDangTai',      'label': 'Thời gian đăng tải',          'aliases': ['Thời gian đăng tải', 'thoiGianDangTai']},
        {'field': 'thoiGianDongThau',     'label': 'Thời gian đóng thầu',         'aliases': ['Thời gian đóng thầu', 'thoiGianDongThau']},
        {'field': 'thoiGianMoThau',       'label': 'Thời gian mở thầu',           'aliases': ['Thời gian mở thầu', 'thoiGianMoThau']},
        {'field': 'soQuyetDinh',          'label': 'Số QĐ phê duyệt',     'aliases': ['Số QĐ phê duyệt', 'Số QĐ', 'soQuyetDinh']},
        {'field': 'ngayQuyetDinh',        'label': 'Ngày QĐ phê duyệt',   'aliases': ['Ngày QĐ phê duyệt', 'Ngày QĐ', 'ngayQuyetDinh']},
        {'field': 'soQuyetDinhKetQua',    'label': 'Số QĐ phê duyệt kết quả LCNT', 'aliases': ['Số QĐ phê duyệt kết quả LCNT', 'Số QĐ kết quả', 'soQuyetDinhKetQua']},
        {'field': 'ngayQuyetDinhKetQua',  'label': 'Ngày ký QĐ kết quả LCNT',     'aliases': ['Ngày ký QĐ kết quả LCNT', 'Ngày QĐ kết quả', 'ngayQuyetDinhKetQua']},
        {'field': 'nhaThauTrungThauId',   'label': 'Nhà thầu trúng thầu',          'aliases': ['Nhà thầu trúng thầu', 'Nhà thầu', 'nhaThauTrungThauId']},
        {'field': 'giaTrungThau',         'label': 'Giá trúng thầu',               'aliases': ['Giá trúng thầu', 'giaTrungThau']},
        {'field': 'thoiGianGoiThau',      'label': 'Thời gian gói thầu',          'aliases': ['Thời gian gói thầu', 'thoiGianGoiThau']},
        {'field': 'thoiGianHopDong',      'label': 'Thời gian hợp đồng',          'aliases': ['Thời gian hợp đồng', 'thoiGianHopDong']},
        {'field': 'giaHanList',           'label': 'Gia hạn thời điểm đóng thầu',  'aliases': ['Gia hạn thời điểm đóng thầu', 'giaHanList']},
        {'field': 'yeuCauLamRoList',      'label': 'Yêu cầu làm rõ HSMT',          'aliases': ['Yêu cầu làm rõ HSMT', 'yeuCauLamRoList']},
        {'field': 'traLoiLamRoList',      'label': 'Trả lời làm rõ HSMT',          'aliases': ['Trả lời làm rõ HSMT', 'traLoiLamRoList']},
        {'field': 'giaToDamBaoDuThau',    'label': 'Giá trị bảo đảm dự thầu',      'aliases': ['Giá trị bảo đảm dự thầu', 'giaToDamBaoDuThau']},
        {'field': 'hieuLucHsdtGoiThau',   'label': 'Hiệu lực HSDT',                'aliases': ['Hiệu lực HSDT', 'hieuLucHsdtGoiThau']},
        {'field': 'hieuLucDamBaoDuThau',  'label': 'Hiệu lực bảo đảm dự thầu',     'aliases': ['Hiệu lực bảo đảm dự thầu', 'hieuLucDamBaoDuThau']},
        {'field': 'awardedPhanLoList',    'label': 'Danh sách phân lô trúng thầu', 'aliases': ['Danh sách phân lô trúng thầu', 'awardedPhanLoList']},
    ],
    'nhathau': [
        {'field': 'loaiNhaThau',          'label': 'Loại nhà thầu',               'aliases': ['Loại nhà thầu', 'loaiNhaThau'],
                                           'options': ['Độc lập', 'Liên danh']},
        {'field': 'maNhaThau',            'label': 'Mã nhà thầu',                 'aliases': ['Mã nhà thầu', 'Mã định danh', 'Mã nhà thầu', 'maNhaThau']},
        {'field': 'tenNhaThau',           'label': 'Tên nhà thầu',                'aliases': ['Tên nhà thầu', 'tenNhaThau']},
        {'field': 'ngayApDung',            'label': 'Ngày áp dụng',               'aliases': ['Ngày áp dụng', 'ngayApDung']},
        {'field': 'tenVietTat',           'label': 'Tên viết tắt',                 'aliases': ['Tên viết tắt', 'Tên VT', 'Viết tắt', 'tenVietTat']},
        {'field': 'maSoThue',             'label': 'Mã số thuế',                  'aliases': ['Mã số thuế', 'MST', 'maSoThue']},
        {'field': 'nguoiDaiDien',         'label': 'Người đại diện',              'aliases': ['Người đại diện', 'nguoiDaiDien']},
        {'field': 'chucVuDaiDien',        'label': 'Chức vụ người đại diện',      'aliases': ['Chức vụ người đại diện', 'chucVuDaiDien']},
        {'field': 'danhXung',             'label': 'Danh xưng',                   'aliases': ['Danh xưng', 'danhXung'],
                                           'options': ['Ông', 'Bà']},
        {'field': 'soDienThoai',          'label': 'Số điện thoại',               'aliases': ['Số điện thoại', 'SĐT', 'soDienThoai']},
        {'field': 'email',                'label': 'Email',                       'aliases': ['Email', 'email']},
        {'field': 'diaChi',               'label': 'Địa chỉ',                    'aliases': ['Địa chỉ', 'diaChi']},
        {'field': 'soTaiKhoan',           'label': 'Số tài khoản',               'aliases': ['Số tài khoản', 'soTaiKhoan']},
        {'field': 'noiMoTaiKhoan',        'label': 'Nơi mở tài khoản',            'aliases': ['Nơi mở tài khoản', 'noiMoTaiKhoan']},
        {'field': 'thanhVienLienDanh',    'label': 'Thành viên liên danh',        'aliases': ['Thành viên liên danh', 'thanhVienLienDanh']},
        {'field': 'maNganHang',           'label': 'Mã ngân hàng',                'aliases': ['Mã ngân hàng', 'maNganHang']},
        {'field': 'anhDau',               'label': 'Ảnh dấu (Base64)',            'aliases': ['Ảnh dấu', 'Ảnh dấu (Base64)', 'anhDau']},
        {'field': 'tenAnhDau',            'label': 'Tên ảnh dấu',                 'aliases': ['Tên ảnh dấu', 'tenAnhDau']},
    ],
    'chuyengia': [
        {'field': 'hoTen',                'label': 'Họ tên',                     'aliases': ['Họ tên', 'Họ và tên', 'hoTen']},
        {'field': 'soCCCD',               'label': 'Số CCCD',                     'aliases': ['Số CCCD', 'CCCD', 'soCCCD']},
        {'field': 'ngayCapCCCD',          'label': 'Ngày cấp CCCD',               'aliases': ['Ngày cấp CCCD', 'ngayCapCCCD']},
        {'field': 'noiCapCCCD',           'label': 'Nơi cấp CCCD',                'aliases': ['Nơi cấp CCCD', 'noiCapCCCD']},
        {'field': 'soChungChi',           'label': 'Số chứng chỉ',               'aliases': ['Số chứng chỉ', 'Số chứng chỉ đấu thầu', 'soChungChi']},
        {'field': 'ngayCapChungChi',      'label': 'Ngày cấp chứng chỉ',         'aliases': ['Ngày cấp', 'Ngày cấp chứng chỉ', 'ngayCapChungChi']},
        {'field': 'donViCapChungChi',     'label': 'Đơn vị cấp chứng chỉ',       'aliases': ['Đơn vị cấp', 'Đơn vị cấp chứng chỉ', 'donViCapChungChi']},
        {'field': 'anhChungChi',          'label': 'Ảnh chứng chỉ (Base64)',      'aliases': ['Ảnh chứng chỉ', 'anhChungChi']},
    ],
    'hopdong': [
        {'field': 'soHopDong',            'label': 'Số hợp đồng',                'aliases': ['Số hợp đồng', 'soHopDong']},
        {'field': 'tenHopDong',           'label': 'Tên hợp đồng',               'aliases': ['Tên hợp đồng', 'tenHopDong']},
        {'field': 'ngayKy',               'label': 'Ngày ký',                    'aliases': ['Ngày ký', 'Ngày ký hợp đồng', 'ngayKy']},
        {'field': 'ngayThanhLy',          'label': 'Ngày thanh lý',              'aliases': ['Ngày thanh lý', 'Ngày thanh lý hợp đồng', 'ngayThanhLy']},
        {'field': 'chuDauTuThanhLyId',    'label': 'Phiên bản CĐT khi thanh lý',  'aliases': ['Phiên bản CĐT khi thanh lý', 'chuDauTuThanhLyId']},
        {'field': 'nhaThauThanhLyId',     'label': 'Phiên bản NT khi thanh lý',   'aliases': ['Phiên bản NT khi thanh lý', 'nhaThauThanhLyId']},
        {'field': 'chuDauTuId',           'label': 'Chủ đầu tư',                  'aliases': ['Chủ đầu tư', 'chuDauTuId']},
        {'field': 'nhaThauId',            'label': 'Nhà thầu',                    'aliases': ['Nhà thầu', 'nhaThauId']},
        {'field': 'giaTri',               'label': 'Giá trị hợp đồng',          'aliases': ['Giá trị', 'Giá trị hợp đồng', 'giaTri']},
        {'field': 'loaiHopDong',          'label': 'Loại hợp đồng',               'aliases': ['Loại hợp đồng', 'loaiHopDong'],
                                           'options': ['Trọn gói', 'Theo đơn giá cố định', 'Theo đơn giá điều chỉnh', 'Theo thời gian', 'Hợp đồng theo tỷ lệ phần trăm', 'Hợp đồng hỗn hợp']},
        {'field': 'phanLoai',             'label': 'Phân loại',                  'aliases': ['Phân loại', 'phanLoai'],
                                           'options': ['Tư vấn', 'Thẩm định', 'Khác']},
        {'field': 'coQdChiDinh',          'label': 'Có QĐ chỉ định thầu không',   'aliases': ['Có QĐ chỉ định thầu không', 'coQdChiDinh'],
                                           'options': ['Không', 'Có']},
        {'field': 'soQdChiDinh',          'label': 'Số QĐ chỉ định',             'aliases': ['Số QĐ chỉ định', 'soQdChiDinh']},
        {'field': 'ngayQdChiDinh',        'label': 'Ngày QĐ chỉ định',           'aliases': ['Ngày QĐ chỉ định', 'ngayQdChiDinh']},
        {'field': 'soNgayThucHien',       'label': 'Thời gian thực hiện hợp đồng', 'aliases': ['Thời gian thực hiện hợp đồng', 'Thời gian thực hiện', 'Số ngày thực hiện', 'Số ngày', 'soNgayThucHien']},
        {'field': 'trangThaiHopDong',      'label': 'Trạng thái hợp đồng',         'aliases': ['Trạng thái hợp đồng', 'Trạng thái', 'trangThaiHopDong']},
        {'field': 'goiThauIds',           'label': 'Gói thầu liên kết',            'aliases': ['Gói thầu liên kết', 'Gói thầu', 'goiThauIds']},
    ],
    'phanlo': [
        {'field': 'maPhanLo',             'label': 'Mã phần lô',                 'aliases': ['Mã phần lô', 'maPhanLo']},
        {'field': 'tenPhanLo',            'label': 'Tên phần lô',                'aliases': ['Tên phần lô', 'Tên phân lô', 'tenPhanLo', 'Tên']},
        {'field': 'giaTriPhanLo',         'label': 'Giá trị phần lô',             'aliases': ['Giá trị phần lô (VND)', 'Giá trị phân lô (VND)', 'Giá trị phần lô', 'Giá trị phân lô', 'Giá trị', 'giaTriPhanLo']},
        {'field': 'baoDamDuThau',         'label': 'Bảo đảm dự thầu',             'aliases': ['Bảo đảm dự thầu (VND)', 'Bảo đảm dự thầu', 'baoDamDuThau']},
        {'field': 'thoiGianThucHien',     'label': 'Thời gian thực hiện',          'aliases': ['Thời gian thực hiện', 'Thời gian', 'thoiGianThucHien']},
    ],
    'tuychonmuathem': [
        {'field': 'hangMuc',              'label': 'Hạng mục',                   'aliases': ['Hạng mục', 'Tên hạng mục', 'hangMuc']},
        {'field': 'donVi',                'label': 'Đơn vị',                     'aliases': ['Đơn vị', 'Đơn vị tính', 'ĐVT', 'donVi']},
        {'field': 'soLuong',              'label': 'Khối lượng / Số lượng',       'aliases': ['Khối lượng/ Số lượng', 'Khối lượng', 'Số lượng', 'soLuong', 'khoiLuong']},
        {'field': 'tyLe',                 'label': 'Tỷ lệ phần trăm (%)',         'aliases': ['Tỷ lệ phần trăm (%)', 'Tỷ lệ phần trăm', 'Tỷ lệ (%)', 'Tỷ lệ', 'tyLe', 'phanTram']},
        {'field': 'giaTriUocTinh',        'label': 'Giá trị ước tính',           'aliases': ['Giá trị ước tính', 'Giá trị', 'giaTriUocTinh']},
    ],
    'ketquaqd': [
        {'field': 'maNhaThau',            'label': 'Mã nhà thầu',                 'aliases': ['Mã nhà thầu', 'Mã định danh', 'Mã số thuế', 'Mã', 'maNhaThau']},
        {'field': 'tenNhaThau',           'label': 'Tên nhà thầu',                'aliases': ['Tên nhà thầu', 'Nhà thầu', 'tenNhaThau']},
        {'field': 'trangThai',            'label': 'Trúng thầu/Trượt thầu',       'aliases': ['Trúng thầu/Trượt thầu', 'Trạng thái', 'Kết quả', 'trangThai'],
                                           'options': ['Trúng thầu', 'Trượt thầu']},
        {'field': 'lyDoTruot',            'label': 'Lý do trượt',                 'aliases': ['Lý do trượt', 'Lý do trượt thầu', 'lyDoTruot']},
        {'field': 'giaTrungThau',         'label': 'Giá trúng thầu',               'aliases': ['Giá trúng thầu', 'Giá trúng', 'Giá trúng thầu (VND)', 'giaTrungThau']},
        {'field': 'thoiGianGoiThau',      'label': 'Thời gian thực hiện gói thầu', 'aliases': ['Thời gian thực hiện gói thầu', 'Thời gian gói', 'thoiGianGoiThau']},
        {'field': 'thoiGianHopDong',      'label': 'Thời gian thực hiện hợp đồng', 'aliases': ['Thời gian thực hiện hợp đồng', 'Thời gian hợp đồng', 'thoiGianHopDong']}
    ],
}

def _schema_to_map_cols(entity_type):
    schema = ENTITY_SCHEMA.get(entity_type)
    if not schema:
        return None
    return {entry['field']: entry['aliases'] for entry in schema}

def _schema_to_headers(entity_type):
    schema = ENTITY_SCHEMA.get(entity_type)
    if not schema:
        return None
    return [entry['label'] for entry in schema]

def _schema_to_options(entity_type):
    schema = ENTITY_SCHEMA.get(entity_type)
    if not schema:
        return {}
    return {entry['label']: entry['options'] for entry in schema if entry.get('options')}

def _schema_to_formats(entity_type):
    """Return Excel formatting metadata from the shared DB field manifest."""
    schema = ENTITY_SCHEMA.get(entity_type)
    table_name = CLIENT_TABLE_MAP.get(entity_type)
    if not schema or not table_name:
        return {}
    manifest = build_field_manifest(json_key_for_column)
    fields = manifest.get('tables', {}).get(table_name, {}).get('fields', {})
    fields_by_json_key = {item['jsonKey']: item for item in fields.values()}
    return {
        entry['label']: fields_by_json_key[entry['field']]['format']
        for entry in schema
        if entry['field'] in fields_by_json_key
    }

def clean_money(val):
    if pd.isna(val):
        return 0
    val_str = str(val).replace("VND", "").replace(".", "").replace(",", "").strip()
    parsed = parse_vnd_amount(val_str)
    return parsed if parsed is not None else 0

def clean_int(val):
    if pd.isna(val):
        return 0
    try:
        return int(float(str(val).strip()))
    except ValueError:
        return 0

def parse_excel(file_bytes, import_type):
    """Phân tích file Excel và trả về danh sách các bản ghi cùng thông tin kiểm thử hợp lệ."""
    map_cols = _schema_to_map_cols(import_type)
    if map_cols is None:
        raise ValueError(f"Invalid type: {import_type}")

    df_raw = pd.read_excel(BytesIO(file_bytes), header=None)

    all_possible_headers = []
    for poss in map_cols.values():
        all_possible_headers.extend([x.lower() for x in poss])

    first_col = [str(x).strip().lower() for x in df_raw.iloc[:, 0].dropna()]
    vertical_matches = sum(1 for v in first_col if v in all_possible_headers)

    first_row = [str(x).strip().lower() for x in df_raw.iloc[0, :].dropna()]
    horizontal_matches = sum(1 for h in first_row if h in all_possible_headers)

    is_vertical = vertical_matches > horizontal_matches and vertical_matches >= 2

    if is_vertical:
        headers = [str(x).strip() for x in df_raw.iloc[:, 0]]
        records = []
        for col_idx in range(1, df_raw.shape[1]):
            col_vals = df_raw.iloc[:, col_idx]
            if all(str(x).strip() == "" or pd.isna(x) for x in col_vals):
                continue

            row_data = {}
            for r_idx, h in enumerate(headers):
                val = col_vals.iloc[r_idx] if r_idx < len(col_vals) else ""
                if pd.isna(val):
                    val = ""
                row_data[h] = val
            records.append(row_data)
        df = pd.DataFrame(records)
    else:
        df = pd.read_excel(BytesIO(file_bytes))

    df.columns = [str(c).strip() for c in df.columns]

    rows = []

    def find_col(possible_names):
        for name in possible_names:
            for col in df.columns:
                if col.lower() == name.lower() or col.lower().replace(" ", "") == name.lower().replace(" ", ""):
                    return col
        return None

    for idx, row in df.iterrows():
        item = {}
        validation_comments = []

        for key, poss in map_cols.items():
            found = find_col(poss)
            val = row[found] if (found is not None) else None
            if pd.isna(val):
                val = ""

            if key in ['tongMucDauTu', 'giaGoiThau', 'giaTri', 'giaTriPhanLo', 'giaTriUocTinh', 'giaTrungThau', 'baoDamDuThau', 'giaDuThau', 'giaSauGiamGia', 'giaTriDamBao']:
                val = clean_money(val)
            elif key in ['soLuong', 'tyLe']:
                try:
                    val = float(str(val).strip()) if val != "" else 0.0
                except ValueError:
                    val = 0.0
            else:
                if isinstance(val, float) and val.is_integer():
                    val = int(val)
                val = str(val).strip()

            item[key] = val

        email_pattern = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
        cccd_pattern = r"^\d{12}$"
        tax_pattern = r"^\d{10}$|^\d{13}$|^\d{10}-\d{3}$"
        phone_pattern = r"^[0-9\s+\-()]{9,15}$"

        if import_type == 'chudautu':
            if not item.get('tenChuDauTu'):
                validation_comments.append("Tên chủ đầu tư không được để trống")
            if not item.get('maChuDauTu'):
                validation_comments.append("Mã chủ đầu tư không được để trống")
            mst = item.get('maSoThue')
            if mst and not re.match(tax_pattern, str(mst).strip()):
                validation_comments.append("Mã số thuế không đúng định dạng (phải gồm 10 hoặc 13 chữ số)")
            email = item.get('email')
            if email and not re.match(email_pattern, str(email).strip()):
                validation_comments.append("Email không đúng định dạng")
            phone = item.get('soDienThoai')
            if phone and not re.match(phone_pattern, str(phone).strip()):
                validation_comments.append("Số điện thoại không hợp lệ")
        elif import_type == 'kehoach':
            if not item.get('tenKeHoach'):
                validation_comments.append("Tên kế hoạch không được để trống")
            if not item.get('maKeHoach'):
                validation_comments.append("Mã kế hoạch không được để trống")
            tong_muc = item.get('tongMucDauTu')
            if tong_muc is not None:
                try:
                    tm_val = int(tong_muc)
                    if tm_val < 0:
                        validation_comments.append("Tổng mức đầu tư không được nhỏ hơn 0")
                except ValueError:
                    validation_comments.append("Tổng mức đầu tư phải là số")
        elif import_type == 'goithau':
            if not item.get('tenGoiThau'):
                validation_comments.append("Tên gói thầu không được để trống")
            if not item.get('maGoiThau'):
                validation_comments.append("Mã gói thầu không được để trống")
            gia = item.get('giaGoiThau')
            if gia is not None:
                try:
                    g_val = int(gia)
                    if g_val < 0:
                        validation_comments.append("Giá gói thầu không được nhỏ hơn 0")
                except ValueError:
                    validation_comments.append("Giá gói thầu phải là số")
            tg = item.get('thoiGianThucHien')
            if tg is not None:
                try:
                    tg_val = int(tg)
                    if tg_val <= 0:
                        validation_comments.append("Thời gian thực hiện phải lớn hơn 0")
                except ValueError:
                    validation_comments.append("Thời gian thực hiện phải là số nguyên")
        elif import_type == 'nhathau':
            if not item.get('tenNhaThau'):
                validation_comments.append("Tên nhà thầu không được để trống")
            if not item.get('maNhaThau'):
                validation_comments.append("Mã nhà thầu không được để trống")
            mst = item.get('maSoThue')
            if mst and not re.match(tax_pattern, str(mst).strip()):
                validation_comments.append("Mã số thuế không đúng định dạng (phải gồm 10 hoặc 13 chữ số)")
            email = item.get('email')
            if email and not re.match(email_pattern, str(email).strip()):
                validation_comments.append("Email không đúng định dạng")
            phone = item.get('soDienThoai')
            if phone and not re.match(phone_pattern, str(phone).strip()):
                validation_comments.append("Số điện thoại không hợp lệ")
        elif import_type == 'chuyengia':
            if not item.get('hoTen'):
                validation_comments.append("Họ và tên không được để trống")
            if not item.get('soChungChi'):
                validation_comments.append("Số chứng chỉ không được để trống")
            cccd = item.get('soCCCD')
            if not cccd:
                validation_comments.append("Số CCCD không được để trống")
            elif not re.match(cccd_pattern, str(cccd).strip()):
                validation_comments.append("Số Căn cước công dân phải gồm đúng 12 chữ số")
            email = item.get('email')
            if email and not re.match(email_pattern, str(email).strip()):
                validation_comments.append("Email không đúng định dạng")
        elif import_type == 'hopdong':
            if not item.get('tenHopDong'):
                validation_comments.append("Tên hợp đồng không được để trống")
            if not item.get('soHopDong'):
                validation_comments.append("Số hợp đồng không được để trống")
            gia_tri = item.get('giaTri')
            if gia_tri is not None:
                try:
                    gt_val = int(gia_tri)
                    if gt_val < 0:
                        validation_comments.append("Giá trị hợp đồng không được nhỏ hơn 0")
                except ValueError:
                    validation_comments.append("Giá trị hợp đồng phải là số")
        elif import_type == 'phanlo':
            if not item.get('tenPhanLo'):
                validation_comments.append("Tên phần lô không được để trống")
        elif import_type == 'tuychonmuathem':
            if not item.get('hangMuc'):
                validation_comments.append("Hạng mục không được để trống")

        rows.append({
            "rowIdx": idx + 2 if not is_vertical else idx + 1,
            "data": item,
            "isValid": len(validation_comments) == 0,
            "comments": "; ".join(validation_comments)
        })

    return rows
