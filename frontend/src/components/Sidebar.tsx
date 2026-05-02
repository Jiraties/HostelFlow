import { Link, useLocation } from "react-router";
import Logo from "./Logo";
import "./Sidebar.css";

const Sidebar = () => {
  let location = useLocation();

  const sidebarItems = [
    { id: 1, label: "หน้าแรก", link: "/", icon: "bx-home" },
    { id: 2, label: "Arrivals", link: "/arrivals", icon: "bx-arrow-to-left" },
    {
      id: 3,
      label: "Departures",
      link: "/departures",
      icon: "bx-arrow-from-left",
    },
    { id: 4, label: "ตารางการจอง", link: "/calendar", icon: "bx-calendar" },
    { id: 5, label: "เอกสาร", link: "/documents", icon: "bx-article" },
    { id: 6, label: "สถิติ", link: "/stats", icon: "bx-bar-chart-big" },
    { id: 7, label: "ตั้งค่า และ ประวัติ", link: "/settings", icon: "bx-cog" },
  ];

  return (
    <div className="sidebar">
      <Logo isAbsolute={false} />

      <ul className="sidebar__navList">
        {sidebarItems.map((item) => (
          <Link key={item.id} to={item.link}>
            <div
              className={
                location.pathname === item.link
                  ? "sidebar__navItem sidebar__navItem--active"
                  : "sidebar__navItem"
              }
            >
              <i className={`bx ${item.icon}`} />
              {item.label}
            </div>
          </Link>
        ))}
      </ul>
    </div>
  );
};

export default Sidebar;
