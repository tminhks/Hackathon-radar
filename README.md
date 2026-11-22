# HACKATHON RADAR — APP WINDOWS (BẢN ELECTRON)

Đây là app thật, có cửa sổ riêng, không phải file chạy nền nữa.
Chỉ có 1 file duy nhất: HackathonRadar.exe. Không cần cài đặt, không cần Node.js.

## CÁCH DÙNG

1. Copy file HackathonRadar.exe vào một thư mục trong tài khoản của bạn,
   ví dụ: `C:\Users\<tên bạn>\HackathonRadar\`
   (Đừng để ở thư mục dùng chung, để trong thư mục của riêng bạn.)
2. Double-click file exe. Lần đầu chạy, app tự quét 7 nguồn (Devpost, Unstop,
   Devfolio, MLH, ETHGlobal, DoraHacks, Reddit) mất vài giây rồi mở dashboard
   trong cửa sổ riêng của app.
3. Muốn mở lại dashboard lúc nào thì double-click file exe lần nữa,
   hoặc bấm vào icon Radar ở khay hệ thống (góc dưới phải màn hình).

## LƯU Ý LẦN ĐẦU CHẠY

- Windows sẽ hiện cảnh báo SmartScreen vì app chưa có chữ ký số.
  Bấm "More info" rồi "Run anyway" là chạy được.
- Nếu bạn còn đang chạy file exe console cũ (bản đen xì trước đây) thì
  tắt nó đi trước, vì 2 app không dùng chung cổng được. Nếu quên thì
  app mới sẽ tự báo lỗi cổng bận.

## KHAY HỆ THỐNG (TRAY)

Bấm chuột phải vào icon Radar ở khay hệ thống để thấy menu:

- **Open Dashboard**: mở lại cửa sổ dashboard.
- **Refresh Now**: quét lại ngay 7 nguồn, không cần đợi 15 phút.
- **Start with Windows**: bật/tắt tự chạy khi đăng nhập. Chỉ áp dụng cho
  tài khoản Windows của riêng bạn, các tài khoản khác trên máy không
  bị ảnh hưởng và không thấy app.
- **Quit**: thoát hẳn app.

Đóng cửa sổ (bấm X) thì app không thoát mà ẩn xuống khay và vẫn quét
nền mỗi 15 phút, có giải mới sẽ hiện thông báo.

## TRONG APP

- Đầy đủ giao diện gốc của Radar: hero, lọc, tìm kiếm (Ctrl+K), chi tiết
  giải, lưu giải, ghi chú, thêm giải tự tạo.
- Nút "Register" mở trang đăng ký trong trình duyệt của bạn.
- Radar AI (ngăn kéo Gemini): nhập Gemini API key của bạn vào trong app
  (lấy miễn phí tại Google AI Studio). Key chỉ lưu trên máy bạn.
- Dữ liệu (cache giải, giải đã lưu, ghi chú, key Gemini) được lưu riêng
  theo tài khoản Windows của bạn, trong `%APPDATA%\Hackathon Radar`,
  nên không mất khi di chuyển file exe và người khác không đọc được.

## GỠ BỎ

Chỉ cần xóa file exe là xong. Muốn xóa sạch cả dữ liệu thì xóa thêm
thư mục `%APPDATA%\Hackathon Radar`.

---

## Dành cho dev (build từ source)

```bash
npm install
npm run dev:app   # chạy thử bằng electron
npm run dist      # build ra dist/HackathonRadar.exe (portable, 1 file)
```

Cấu trúc:

- `electron/main.cjs` — tiến trình chính Electron (cửa sổ, tray, thông báo,
  kiểm tra cổng bận, Start with Windows).
- `server.mjs` + `src/` — backend Node quét 7 nguồn + API + phục vụ dashboard,
  chạy như process con của app (qua `ELECTRON_RUN_AS_NODE`), đọc
  `RADAR_DATA_DIR` để ghi dữ liệu vào `%APPDATA%\Hackathon Radar`.
- `public/` — giao diện dashboard.
