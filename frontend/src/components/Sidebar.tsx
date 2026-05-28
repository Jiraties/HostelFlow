import { Link, useLocation } from "react-router";
import { useState } from "react";
import Logo from "./Logo";
import "./Sidebar.css";
import { useAuth } from "../context/AuthContext";

const Sidebar = () => {
  const location = useLocation();
  const { user } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const sidebarItems = user?.admin
    ? [
        { id: 1, label: "หน้าแรก", link: "/", icon: "bx-home" },
        {
          id: 99,
          label: "จัดการ",
          link: "/manage",
          icon: "bx-group",
        },
        {
          id: 2,
          label: "เช็คอินวันนี้",
          link: "/arrivals",
          icon: "bx-arrow-to-left",
        },
        {
          id: 3,
          label: "เช็คเอาท์วันนี้",
          link: "/departures",
          icon: "bx-arrow-from-left",
        },
        { id: 4, label: "รายการจองทั้งหมด", link: "/master", icon: "bx-table" },
        { id: 5, label: "ตารางการจอง", link: "/calendar", icon: "bx-calendar" },
        { id: 6, label: "เอกสาร", link: "/documents", icon: "bx-article" },
        // { id: 7, label: "สถิติ", link: "/stats", icon: "bx-bar-chart-big" },
        {
          id: 8,
          label: "ตั้งค่า และ ประวัติ",
          link: "/settings",
          icon: "bx-cog",
        },
      ]
    : [
        { id: 1, label: "หน้าแรก", link: "/", icon: "bx-home" },
        {
          id: 2,
          label: "เช็คอินวันนี้",
          link: "/arrivals",
          icon: "bx-arrow-to-left",
        },
        {
          id: 3,
          label: "เช็คเอาท์วันนี้",
          link: "/departures",
          icon: "bx-arrow-from-left",
        },
        { id: 4, label: "รายการจองทั้งหมด", link: "/master", icon: "bx-table" },
        { id: 5, label: "ตารางการจอง", link: "/calendar", icon: "bx-calendar" },
        { id: 6, label: "เอกสาร", link: "/documents", icon: "bx-article" },
        {
          id: 8,
          label: "ตั้งค่า และ ประวัติ",
          link: "/settings",
          icon: "bx-cog",
        },
      ];

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

      <ul className="sidebar__navList">
        {sidebarItems.map((item) => (
          <Link key={item.id} to={item.link} title={item.label}>
            <div
              className={
                location.pathname === item.link
                  ? "sidebar__navItem sidebar__navItem--active"
                  : "sidebar__navItem"
              }
            >
              <i className={`bx ${item.icon}`} />
              <span className="sidebar__navLabel">{item.label}</span>
            </div>
          </Link>
        ))}
      </ul>
    </div>
  );
};

export default Sidebar;
