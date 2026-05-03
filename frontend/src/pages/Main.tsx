import { Link } from "react-router";

import { useAuth } from "../context/AuthContext";
import "./Main.css";

const Main = () => {
  const { user, logout } = useAuth();

  const fullFormattedDate = new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "long",
    year: "numeric",
    calendar: "gregory",
  }).format(new Date());

  return (
    <main className="home">
      <header className="home__header">
        <div>
          <h1>{fullFormattedDate}</h1>
          <div style={{ display: "flex", gap: "0.3rem" }}>
            <p>
              {/* ข้อมูลอัปเดตล่าสุดเมื่อ {lastUpdated?.getHours()}:
              {lastUpdated?.getMinutes().toString().padStart(2, "0")} */}
            </p>
            <i
              className="bx bx-refresh home__refreshIcon"
              onClick={() => {
                // toast.promise(fetchBookings(), {
                //   loading: "กำลังอัปเดตข้อมูล...",
                //   success: "อัปเดตข้อมูลสำเร็จ",
                //   error: "เกิดข้อผิดพลาดในการอัปเดตข้อมูล",
                // });
              }}
            />
          </div>
        </div>

        <div className="home__headerProfile">
          <p>
            {user?.name} <strong>{"  " + (user?.admin ? " Admin" : "")}</strong>
          </p>
          <Link to={"/settings"}>
            <img
              className="home__profileImg"
              src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcR3m972e8FEvBi7ETC03avlJcZDg8nT9dWLSw&s"
              alt="profilePicture"
            />
          </Link>
        </div>
      </header>

      <div className="main__stats">
        <div className="main__statsItem">
          <i
            className="bx-bed-alt main__statsItem--icon"
            style={{ backgroundColor: "#3bbf5810", color: "#3bbf58" }}
          />
          <div className="main__statsItem--texts">
            <p>Occupied</p>
            <h3>78%</h3>
            <p>14/18 Beds Filled</p>
          </div>
        </div>
      </div>
    </main>
  );
};

export default Main;
