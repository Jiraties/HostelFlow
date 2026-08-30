import toast from "react-hot-toast";

import { IS_DEMO_MODE } from "../config/api";
import { resetDemoData } from "./demoApi";

import "./DemoBanner.css";

const DemoBanner = () => {
  if (!IS_DEMO_MODE) return null;

  const reset = () => {
    resetDemoData();
    toast.success("รีเซ็ตข้อมูลตัวอย่างแล้ว");
    window.setTimeout(() => window.location.assign("/"), 350);
  };

  return (
    <aside className="demoBanner" aria-label="โหมดทดลอง">
      <div className="demoBanner__message">
        <span className="demoBanner__dot" aria-hidden="true" />
        <span>
          <strong>Demo mode</strong> · ข้อมูลทั้งหมดเป็นข้อมูลตัวอย่างในเบราว์เซอร์นี้
        </span>
      </div>
      <button type="button" className="demoBanner__reset" onClick={reset}>
        <i className="bx bx-reset" aria-hidden="true" />
        รีเซ็ตข้อมูล
      </button>
    </aside>
  );
};

export default DemoBanner;
