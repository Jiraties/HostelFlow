import { useEffect, useRef, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import axios from "axios";
import { Link, useNavigate } from "react-router";

import { useAuth } from "../context/AuthContext";
import { API_URL } from "../config/api";

import "./PageHeader.css";
import { profilePictureUrl } from "../helpers/profilePictureUrl";

type RefreshMessages = {
  loading: string;
  success: string;
  error: string;
};

type PageHeaderProps = {
  title: ReactNode;
  className?: string;
  lastUpdated?: Date | null;
  onRefresh?: () => Promise<unknown> | unknown;
  refreshMessages?: RefreshMessages;
  meta?: ReactNode;
};

const defaultRefreshMessages: RefreshMessages = {
  loading: "กำลังอัปเดตข้อมูล...",
  success: "อัปเดตข้อมูลสำเร็จ",
  error: "เกิดข้อผิดพลาดในการอัปเดตข้อมูล",
};

const formatLastUpdated = (lastUpdated?: Date | null) => {
  if (!lastUpdated) return "--:--";

  return `${lastUpdated.getHours()}:${lastUpdated
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
};

const PageHeader = ({
  title,
  className = "",
  lastUpdated,
  onRefresh,
  refreshMessages = defaultRefreshMessages,
  meta,
}: PageHeaderProps) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const profileRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (!profileMenuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const closeOnOutsideFocus = (event: FocusEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setProfileMenuOpen(false);
      profileButtonRef.current?.focus();
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("focusin", closeOnOutsideFocus);
    document.addEventListener("keydown", closeOnEscape);
    menuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus();

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("focusin", closeOnOutsideFocus);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileMenuOpen]);

  const handleRefresh = () => {
    if (!onRefresh) return;

    toast.promise(Promise.resolve(onRefresh()), refreshMessages);
  };

  const handleLogout = async () => {
    if (loggingOut) return;

    setLoggingOut(true);
    setProfileMenuOpen(false);

    try {
      await axios.post(
        `${API_URL}/auth/logout`,
        {},
        { withCredentials: true },
      );
      logout();
      navigate("/");
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <header className={`pageHeader ${className}`.trim()}>
      <div>
        <h1>{title}</h1>
        {(meta || onRefresh) && (
          <div className="pageHeader__meta">
            {meta || (
              <p className="pageHeader__updatedAt">
                อัปเดตล่าสุด {formatLastUpdated(lastUpdated)}
              </p>
            )}
            {onRefresh && (
              <button
                className="pageHeader__refreshAction"
                type="button"
                aria-label="อัปเดตข้อมูล"
                onClick={handleRefresh}
              >
                <i className="bx bx-refresh-cw pageHeader__refreshIcon" />
              </button>
            )}
          </div>
        )}
      </div>

      <div ref={profileRef} className="pageHeader__profile">
        <p>
          {user?.name} {user?.admin && <strong>Admin</strong>}
        </p>
        <button
          ref={profileButtonRef}
          className="pageHeader__profileButton"
          type="button"
          aria-label="เปิดเมนูโปรไฟล์"
          aria-haspopup="menu"
          aria-expanded={profileMenuOpen}
          onClick={() => setProfileMenuOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown") return;
            event.preventDefault();
            setProfileMenuOpen(true);
          }}
        >
          <img
            className="pageHeader__profileImg"
            src={profilePictureUrl(user?.profilePictureUrl)}
            alt=""
          />
        </button>

        {profileMenuOpen && (
          <div
            ref={menuRef}
            className="pageHeader__profileMenu"
            role="menu"
            aria-label="เมนูโปรไฟล์"
            onKeyDown={(event) => {
              if (
                event.key !== "ArrowDown" &&
                event.key !== "ArrowUp" &&
                event.key !== "Home" &&
                event.key !== "End"
              ) {
                return;
              }

              const items = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  '[role="menuitem"]:not([disabled])',
                ),
              );
              if (items.length === 0) return;

              event.preventDefault();
              const currentIndex = items.indexOf(
                document.activeElement as HTMLElement,
              );
              const nextIndex =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : event.key === "ArrowUp"
                      ? (currentIndex - 1 + items.length) % items.length
                      : (currentIndex + 1) % items.length;
              items[nextIndex]?.focus();
            }}
          >
            <div className="pageHeader__profileMenuIdentity">
              <p>{user?.name || "ไม่ทราบชื่อ"}</p>
              <span>@{user?.username || "-"}</span>
              {user?.admin && <small>Admin</small>}
            </div>
            <div className="pageHeader__profileMenuActions">
              <Link
                to="/settings"
                role="menuitem"
                onClick={() => setProfileMenuOpen(false)}
              >
                <i className="bx bx-cog" aria-hidden="true" />
                ตั้งค่า
              </Link>
              <button
                type="button"
                role="menuitem"
                className="pageHeader__logoutAction"
                disabled={loggingOut}
                onClick={() =>
                  toast.promise(handleLogout(), {
                    loading: "กำลังออกจากระบบ...",
                    success: "ออกจากระบบแล้ว",
                    error: (error) =>
                      error.response?.data?.message ||
                      "ไม่สามารถออกจากระบบได้",
                  })
                }
              >
                <i
                  className="bx bx-arrow-out-right-square-half"
                  aria-hidden="true"
                />
                ออกจากระบบ
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default PageHeader;
