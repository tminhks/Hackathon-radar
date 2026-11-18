using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Media;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace HackathonRadarDesktop
{
    public class RadarTrayContext : ApplicationContext
    {
        private NotifyIcon trayIcon;
        private Process serverProcess;
        private System.Windows.Forms.Timer pollTimer;
        private string appDir;
        private string baseUrl = "http://127.0.0.1:4567";
        private string lastNotificationUrl = "http://127.0.0.1:4567";
        private bool isPolling = false;
        private MenuItem startupMenuItem;
        private MenuItem freq1Item;
        private MenuItem freq3Item;
        private MenuItem freq10Item;
        private MenuItem freq30Item;

        public RadarTrayContext(bool silentStartup)
        {
            appDir = AppDomain.CurrentDomain.BaseDirectory;
            EnsureBackendRunning();

            Icon customIcon = LoadAppIcon();
            ContextMenu menu = BuildContextMenu();

            trayIcon = new NotifyIcon();
            trayIcon.Icon = customIcon;
            trayIcon.Text = "Hackathon Radar — Săn giải toàn cầu 24/7";
            trayIcon.ContextMenu = menu;
            trayIcon.Visible = true;

            trayIcon.DoubleClick += delegate { OpenAppWindow(baseUrl); };
            trayIcon.BalloonTipClicked += delegate
            {
                if (!string.IsNullOrEmpty(lastNotificationUrl))
                {
                    if (lastNotificationUrl.StartsWith("http://127.0.0.1") || lastNotificationUrl.StartsWith("http://localhost"))
                        OpenAppWindow(baseUrl);
                    else
                        Process.Start(lastNotificationUrl);
                }
            };

            if (!silentStartup)
            {
                OpenAppWindow(baseUrl);
            }

            ShowNativeAlert(
                "Hackathon Radar Desktop đã bật!",
                "Ứng dụng đang chạy ngầm ở khay hệ thống & tự động bắn thông báo Kèo Thơm định kỳ.",
                baseUrl
            );

            pollTimer = new System.Windows.Forms.Timer();
            pollTimer.Interval = 3000;
            pollTimer.Tick += delegate { PollPendingNotifications(); };
            pollTimer.Start();
        }

        private Icon LoadAppIcon()
        {
            string icoPath = Path.Combine(appDir, "radar-icon.ico");
            if (File.Exists(icoPath))
            {
                try { return new Icon(icoPath); } catch { }
            }
            return Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);
        }

        private ContextMenu BuildContextMenu()
        {
            ContextMenu menu = new ContextMenu();

            MenuItem openItem = new MenuItem("Mở cửa sổ Hackathon Radar", delegate { OpenAppWindow(baseUrl); });
            openItem.DefaultItem = true;
            menu.MenuItems.Add(openItem);

            menu.MenuItems.Add("-");

            MenuItem testAlertItem = new MenuItem("Bắn thử thông báo Kèo Thơm ngay", delegate { PostApiAsync("/api/notify/test", "{}"); });
            menu.MenuItems.Add(testAlertItem);

            MenuItem scanNowItem = new MenuItem("Quét giải mới toàn cầu ngay", delegate
            {
                ShowNativeAlert("Đang quét 6 sàn quốc tế...", "Hệ thống sẽ báo kết quả ngay khi hoàn tất.", baseUrl);
                PostApiAsync("/api/refresh", "{}");
            });
            menu.MenuItems.Add(scanNowItem);

            MenuItem freqMenu = new MenuItem("Tần suất bắn thông báo");
            freq1Item = new MenuItem("Siêu dày — Mỗi 1 phút (Liên tục)", delegate { SetFrequency(1); });
            freq3Item = new MenuItem("Nhiều — Mỗi 3 phút (Mặc định)", delegate { SetFrequency(3); });
            freq10Item = new MenuItem("Vừa phải — Mỗi 10 phút", delegate { SetFrequency(10); });
            freq30Item = new MenuItem("Tiết kiệm — Mỗi 30 phút", delegate { SetFrequency(30); });
            freq3Item.Checked = true;
            freqMenu.MenuItems.Add(freq1Item);
            freqMenu.MenuItems.Add(freq3Item);
            freqMenu.MenuItems.Add(freq10Item);
            freqMenu.MenuItems.Add(freq30Item);
            menu.MenuItems.Add(freqMenu);

            menu.MenuItems.Add("-");

            MenuItem desktopShortcutItem = new MenuItem("Tạo biểu tượng App ngoài Desktop", delegate { CreateShortcut(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), false); });
            menu.MenuItems.Add(desktopShortcutItem);

            startupMenuItem = new MenuItem("Tự khởi động ngầm cùng Windows", delegate { ToggleStartup(); });
            startupMenuItem.Checked = File.Exists(GetStartupShortcutPath());
            menu.MenuItems.Add(startupMenuItem);

            menu.MenuItems.Add("-");

            MenuItem exitItem = new MenuItem("Thoát hẳn Hackathon Radar", delegate { ExitCleanly(); });
            menu.MenuItems.Add(exitItem);

            return menu;
        }

        private void SetFrequency(int mins)
        {
            freq1Item.Checked = (mins == 1);
            freq3Item.Checked = (mins == 3);
            freq10Item.Checked = (mins == 10);
            freq30Item.Checked = (mins == 30);

            string json = string.Format("{{\"enabled\":true,\"cadenceMinutes\":{0}}}", mins);
            PostApiAsync("/api/notify-settings", json);
            ShowNativeAlert("Da cap nhat tan suat thong bao", string.Format("Radar se ban thong bao giai moi & Keo Thom moi {0} phut.", mins), baseUrl);
        }

        private string GetStartupShortcutPath()
        {
            string startupDir = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
            return Path.Combine(startupDir, "Hackathon Radar.lnk");
        }

        private void ToggleStartup()
        {
            string lnk = GetStartupShortcutPath();
            if (File.Exists(lnk))
            {
                try { File.Delete(lnk); } catch { }
                startupMenuItem.Checked = false;
                ShowNativeAlert("Da tat khoi dong cung Windows", "Ban van co the mo HackathonRadar.exe bat cu luc nao.", baseUrl);
            }
            else
            {
                CreateShortcut(Environment.GetFolderPath(Environment.SpecialFolder.Startup), true);
                startupMenuItem.Checked = File.Exists(lnk);
            }
        }

        private void CreateShortcut(string folder, bool silentArg)
        {
            try
            {
                string lnkPath = Path.Combine(folder, "Hackathon Radar.lnk");
                string exePath = Assembly.GetExecutingAssembly().Location;
                string icoPath = Path.Combine(appDir, "radar-icon.ico");
                string args = silentArg ? "--background" : "";

                string ps = string.Format(
                    "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('{0}'); $s.TargetPath = '{1}'; $s.WorkingDirectory = '{2}'; $s.Arguments = '{3}'; if (Test-Path '{4}') {{ $s.IconLocation = '{4}' }}; $s.Save()",
                    lnkPath.Replace("'", "''"),
                    exePath.Replace("'", "''"),
                    appDir.Replace("'", "''"),
                    args,
                    icoPath.Replace("'", "''")
                );

                ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", "-NoProfile -WindowStyle Hidden -Command \"" + ps + "\"");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                Process p = Process.Start(psi);
                p.WaitForExit(3000);

                ShowNativeAlert(
                    silentArg ? "Da bat Tu khoi dong cung Windows!" : "Da tao bieu tuong ngoai Desktop!",
                    silentArg ? "Radar se tu chay ngam va bao giai moi moi khi ban bat may." : "Ban co the mo nhanh Hackathon Radar ngay tren man hinh chinh.",
                    baseUrl
                );
            }
            catch (Exception ex)
            {
                MessageBox.Show("Khong the tao shortcut: " + ex.Message);
            }
        }

        private bool IsBackendOnline()
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(baseUrl + "/api/notifications");
                req.Timeout = 900;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    return resp.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private void EnsureBackendRunning()
        {
            if (IsBackendOnline()) return;

            try
            {
                string serverJs = Path.Combine(appDir, "server.mjs");
                if (!File.Exists(serverJs)) return;

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "node";
                psi.Arguments = "\"" + serverJs + "\"";
                psi.WorkingDirectory = appDir;
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.WindowStyle = ProcessWindowStyle.Hidden;

                serverProcess = Process.Start(psi);

                for (int i = 0; i < 12; i++)
                {
                    Thread.Sleep(250);
                    if (IsBackendOnline()) break;
                }
            }
            catch { }
        }

        public static void OpenAppWindow(string url)
        {
            string[] candidates = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google\\Chrome\\Application\\chrome.exe")
            };

            foreach (string browser in candidates)
            {
                if (File.Exists(browser))
                {
                    try
                    {
                        ProcessStartInfo psi = new ProcessStartInfo();
                        psi.FileName = browser;
                        psi.Arguments = string.Format("--app={0} --window-size=1320,860", url);
                        psi.UseShellExecute = true;
                        Process.Start(psi);
                        return;
                    }
                    catch { }
                }
            }

            try { Process.Start(url); } catch { }
        }

        private void ShowNativeAlert(string title, string message, string targetUrl)
        {
            lastNotificationUrl = string.IsNullOrEmpty(targetUrl) ? baseUrl : targetUrl;
            try
            {
                SystemSounds.Asterisk.Play();
                trayIcon.BalloonTipTitle = title.Length > 62 ? title.Substring(0, 62) : title;
                trayIcon.BalloonTipText = message.Length > 220 ? message.Substring(0, 220) : message;
                trayIcon.BalloonTipIcon = ToolTipIcon.Info;
                trayIcon.ShowBalloonTip(8000);
            }
            catch { }
        }

        private void PollPendingNotifications()
        {
            if (isPolling) return;
            isPolling = true;

            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(baseUrl + "/api/notifications/pending?consumer=tray");
                    req.Timeout = 2000;
                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                    using (StreamReader sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    {
                        string body = sr.ReadToEnd();
                        JavaScriptSerializer jss = new JavaScriptSerializer();
                        Dictionary<string, object> root = jss.Deserialize<Dictionary<string, object>>(body);
                        if (root != null && root.ContainsKey("liveCount"))
                        {
                            int cnt = Convert.ToInt32(root["liveCount"]);
                            string tip = string.Format("Hackathon Radar — {0} giai dang mo toan cau", cnt);
                            if (tip.Length <= 63) trayIcon.Text = tip;
                        }
                        if (root != null && root.ContainsKey("items"))
                        {
                            ArrayList items = root["items"] as ArrayList;
                            if (items != null && items.Count > 0)
                            {
                                Dictionary<string, object> latest = items[0] as Dictionary<string, object>;
                                if (latest != null)
                                {
                                    string t = latest.ContainsKey("title") ? Convert.ToString(latest["title"]) : "Hackathon Radar";
                                    string m = latest.ContainsKey("message") ? Convert.ToString(latest["message"]) : "";
                                    string u = latest.ContainsKey("url") ? Convert.ToString(latest["url"]) : baseUrl;
                                    ShowNativeAlert(t, m, u);
                                }
                            }
                        }
                    }
                }
                catch
                {
                    EnsureBackendRunning();
                }
                finally
                {
                    isPolling = false;
                }
            });
        }

        private void PostApiAsync(string path, string jsonPayload)
        {
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    byte[] bytes = Encoding.UTF8.GetBytes(jsonPayload);
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(baseUrl + path);
                    req.Method = "POST";
                    req.ContentType = "application/json; charset=utf-8";
                    req.ContentLength = bytes.Length;
                    req.Timeout = 15000;
                    using (Stream s = req.GetRequestStream())
                    {
                        s.Write(bytes, 0, bytes.Length);
                    }
                    using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) { }
                }
                catch { }
            });
        }

        private void ExitCleanly()
        {
            pollTimer.Stop();
            trayIcon.Visible = false;
            trayIcon.Dispose();
            if (serverProcess != null && !serverProcess.HasExited)
            {
                try { serverProcess.Kill(); } catch { }
            }
            Application.Exit();
        }
    }

    public static class Program
    {
        [STAThread]
        public static void Main(string[] args)
        {
            bool createdNew;
            using (Mutex mutex = new Mutex(true, "Local\\HackathonRadarDesktopSingleton", out createdNew))
            {
                if (!createdNew)
                {
                    RadarTrayContext.OpenAppWindow("http://127.0.0.1:4567");
                    return;
                }

                bool silent = args != null && args.Length > 0 && args[0] == "--background";
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new RadarTrayContext(silent));
            }
        }
    }
}
