import { Link, useLocation } from "react-router";
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import Logo from "./Logo";
import "./Sidebar.css";
import { useAuth } from "../context/AuthContext";
import { useCommandPalette } from "../context/commandPalette";
import { navigationItems } from "./navigationItems";
import { API_URL } from "../config/api";
import { REVIEW_QUEUE_UPDATED_EVENT } from "../helpers/reviewQueue";

const usesAppleKeyboard = () => {
  if (typeof navigator === "undefined") return false;

  return /Mac|iPhone|iPad|iPod/i.test(
    `${navigator.platform || ""} ${navigator.userAgent || ""}`,
  );
};

const Sidebar = () => {
  const location = useLocation();
  const { user } = useAuth();
  const { openPalette } = useCommandPalette();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [reviewQueueCount, setReviewQueueCount] = useState(0);
  const [bookingReviewCount, setBookingReviewCount] = useState(0);
  const [isAppleKeyboard] = useState(usesAppleKeyboard);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const moreSheetRef = useRef<HTMLElement>(null);
  const sidebarItems = navigationItems.filter(
    (item) => !item.adminOnly || user?.admin,
  );
  const settingsItem = sidebarItems.find((item) => item.link === "/settings");
  const desktopGroups = [
    {
      id: "overview",
      label: "ภาพรวม",
      items: sidebarItems.filter((item) =>
        ["/", "/analytics"].includes(item.link),
      ),
    },
    {
      id: "stays",
      label: "Operations",
      items: sidebarItems.filter((item) =>
        ["/arrivals", "/departures", "/calendar", "/master"].includes(
          item.link,
        ),
      ),
    },
    {
      id: "tools",
      label: "Workspace",
      items: sidebarItems.filter((item) =>
        ["/documents", "/manage"].includes(item.link),
      ),
    },
  ].filter((group) => group.items.length > 0);
  const sidebarItemByLink = new Map(
    sidebarItems.map((item) => [item.link, item]),
  );
  const mobileItems = [
    sidebarItemByLink.get("/"),
    sidebarItemByLink.get("/master"),
    sidebarItemByLink.get(user?.admin ? "/manage" : "/documents"),
    sidebarItemByLink.get("/calendar"),
  ].filter((item) => item !== undefined);
  const mobileItemLinks = new Set(mobileItems.map((item) => item.link));
  const moreItems = sidebarItems.filter(
    (item) => !mobileItemLinks.has(item.link),
  );
  const moreIsActive = moreItems.some(
    (item) => item.link === location.pathname,
  );
  const searchShortcutLabel = isAppleKeyboard ? "⌘ K" : "Ctrl K";

  useEffect(() => {
    let active = true;
    const refreshBookingReviewCount = async () => {
      try {
        const response = await axios.get<{ count: number }>(
          `${API_URL}/bookings/getNeedsReviewBookings/count`,
          { withCredentials: true },
        );
        if (active && Number.isFinite(response.data.count)) {
          setBookingReviewCount(Math.max(0, response.data.count));
        }
      } catch {
        // The badge is supplementary; keep the last known count on failure.
      }
    };
    const refresh = () => void refreshBookingReviewCount();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    refresh();
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener(REVIEW_QUEUE_UPDATED_EVENT, refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(REVIEW_QUEUE_UPDATED_EVENT, refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (!user?.admin) return;

    let active = true;
    const refreshReviewQueueCount = async () => {
      try {
        const response = await axios.get<{ count: number }>(
          `${API_URL}/finance/review-events/count`,
          { withCredentials: true },
        );
        if (active && Number.isFinite(response.data.count)) {
          setReviewQueueCount(Math.max(0, response.data.count));
        }
      } catch {
        // The badge is supplementary; keep the last known count on failure.
      }
    };
    const refresh = () => void refreshReviewQueueCount();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    refresh();
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener(REVIEW_QUEUE_UPDATED_EVENT, refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(REVIEW_QUEUE_UPDATED_EVENT, refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [user?.admin]);

  useEffect(() => {
    if (!isMoreOpen) return;

    const previousOverflow = document.body.style.overflow;
    const desktopQuery = window.matchMedia("(min-width: 761px)");
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMoreOpen(false);
    };
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setIsMoreOpen(false);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    desktopQuery.addEventListener("change", closeOnDesktop);
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      desktopQuery.removeEventListener("change", closeOnDesktop);
    };
  }, [isMoreOpen]);

  return (
    <div className={isCollapsed ? "sidebar sidebar--collapsed" : "sidebar"}>
      <div className="sidebar__top">
        {!isCollapsed && <Logo isAbsolute={false} />}
        <button
          className="sidebar__toggle"
          type="button"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setIsCollapsed((prev) => !prev)}
        >
          <i
            className={
              isCollapsed ? "bx bx-chevrons-right" : "bx bx-chevrons-left"
            }
          />
        </button>
      </div>

      <button
        className="sidebar__searchAction"
        type="button"
        aria-label="เปิดค้นหาทั่วทั้งระบบ"
        aria-keyshortcuts="Control+K Meta+K"
        title={`ค้นหา (${searchShortcutLabel})`}
        onClick={() => openPalette()}
      >
        <i className="bx bx-search" aria-hidden="true" />
        <span className="sidebar__navLabel">ค้นหา</span>
        <kbd aria-hidden="true">{searchShortcutLabel}</kbd>
      </button>

      <nav
        className="sidebar__navList sidebar__navList--desktop"
        aria-label="เมนูหลัก"
      >
        {desktopGroups.map((group) => (
          <section className="sidebar__navGroup" key={group.id}>
            <h2 className="sidebar__groupLabel">{group.label}</h2>
            <ul>
              {group.items.map((item) => (
                <li key={item.id}>
                  <Link
                    to={item.link}
                    title={item.label}
                    aria-current={
                      location.pathname === item.link ? "page" : undefined
                    }
                    className={
                      location.pathname === item.link
                        ? "sidebar__navItem sidebar__navItem--active"
                        : "sidebar__navItem"
                    }
                  >
                    <i className={`bx ${item.icon}`} aria-hidden="true" />
                    <span className="sidebar__navLabel">{item.label}</span>
                    {item.link === "/manage" && reviewQueueCount > 0 && (
                      <span
                        className="sidebar__notificationBadge"
                        aria-label={`${reviewQueueCount} รายการรออนุมัติ`}
                        title={`${reviewQueueCount} รายการรออนุมัติ`}
                      >
                        <span className="sidebar__notificationBadgeValue">
                          {reviewQueueCount > 99 ? "99+" : reviewQueueCount}
                        </span>
                      </span>
                    )}
                    {item.link === "/" && bookingReviewCount > 0 && (
                      <span
                        className="sidebar__notificationBadge"
                        aria-label={`${bookingReviewCount} รายการจองที่ต้องตรวจสอบ`}
                        title={`${bookingReviewCount} รายการจองที่ต้องตรวจสอบ`}
                      >
                        <span className="sidebar__notificationBadgeValue">
                          {bookingReviewCount > 99 ? "99+" : bookingReviewCount}
                        </span>
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>

      {settingsItem && (
        <>
          <p className="sidebar__version">HostelFlow v1.1</p>
          <Link
            to={settingsItem.link}
            title={settingsItem.label}
            aria-current={
              location.pathname === settingsItem.link ? "page" : undefined
            }
            className={
              location.pathname === settingsItem.link
                ? "sidebar__settingsAction sidebar__settingsAction--active"
                : "sidebar__settingsAction"
            }
          >
            <span className="sidebar__settingsIcon" aria-hidden="true">
              <i className={`bx ${settingsItem.icon}`} />
            </span>
            <span className="sidebar__settingsCopy sidebar__navLabel">
              <strong>ตั้งค่า</strong>
            </span>
            <i
              className="bx bx-chevron-right sidebar__settingsChevron"
              aria-hidden="true"
            />
          </Link>
        </>
      )}

      <nav className="mobileNav" aria-label="เมนูหลัก">
        {mobileItems.map((item) => (
          <Link
            key={item.id}
            to={item.link}
            aria-current={location.pathname === item.link ? "page" : undefined}
            className={
              location.pathname === item.link
                ? "mobileNav__item mobileNav__item--active"
                : "mobileNav__item"
            }
            onClick={() => setIsMoreOpen(false)}
          >
            <i className={`bx ${item.icon}`} aria-hidden="true" />
            <span>{item.mobileLabel || item.label}</span>
            {item.link === "/manage" && reviewQueueCount > 0 && (
              <span
                className="sidebar__notificationBadge sidebar__notificationBadge--mobileNav"
                aria-label={`${reviewQueueCount} รายการที่ต้องตรวจสอบ`}
                title={`${reviewQueueCount} รายการที่ต้องตรวจสอบ`}
              >
                <span className="sidebar__notificationBadgeValue">
                  {reviewQueueCount > 99 ? "99+" : reviewQueueCount}
                </span>
              </span>
            )}
            {item.link === "/" && bookingReviewCount > 0 && (
              <span
                className="sidebar__notificationBadge sidebar__notificationBadge--mobileNav"
                aria-label={`${bookingReviewCount} รายการจองที่ต้องตรวจสอบ`}
                title={`${bookingReviewCount} รายการจองที่ต้องตรวจสอบ`}
              >
                <span className="sidebar__notificationBadgeValue">
                  {bookingReviewCount > 99 ? "99+" : bookingReviewCount}
                </span>
              </span>
            )}
          </Link>
        ))}
        <button
          className={
            moreIsActive || isMoreOpen
              ? "mobileNav__item mobileNav__item--active"
              : "mobileNav__item"
          }
          type="button"
          aria-haspopup="dialog"
          aria-expanded={isMoreOpen}
          onClick={() => setIsMoreOpen(true)}
        >
          <i className="bx bx-dots-horizontal-rounded" aria-hidden="true" />
          <span>เพิ่มเติม</span>
        </button>
      </nav>

      {isMoreOpen && (
        <div
          className="mobileMore"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsMoreOpen(false);
          }}
        >
          <section
            ref={moreSheetRef}
            className="mobileMore__sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-more-title"
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;

              const focusable =
                moreSheetRef.current?.querySelectorAll<HTMLElement>(
                  'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
                );
              if (!focusable?.length) return;

              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            <div className="mobileMore__handle" aria-hidden="true" />
            <div className="mobileMore__header">
              <h2 id="mobile-more-title"></h2>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="ปิดเมนูเพิ่มเติม"
                onClick={() => setIsMoreOpen(false)}
              >
                <i className="bx bx-x" aria-hidden="true" />
              </button>
            </div>
            <div className="mobileMore__grid">
              <button
                className="mobileMore__item mobileMore__item--search"
                type="button"
                onClick={() => {
                  setIsMoreOpen(false);
                  window.requestAnimationFrame(() => openPalette());
                }}
              >
                <i className="bx bx-search" aria-hidden="true" />
                <span>ค้นหา</span>
              </button>
              {moreItems.map((item) => (
                <Link
                  key={item.id}
                  to={item.link}
                  aria-current={
                    location.pathname === item.link ? "page" : undefined
                  }
                  className={
                    location.pathname === item.link
                      ? "mobileMore__item mobileMore__item--active"
                      : "mobileMore__item"
                  }
                  onClick={() => setIsMoreOpen(false)}
                >
                  <i className={`bx ${item.icon}`} aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default Sidebar;
