import { Link } from "react-router";
import "./NotFound.css";
import usePageTitle from "../hooks/useTitle";

const NotFound = () => {
  usePageTitle("HostelFlow · ไม่พบหน้า");

  return (
    <div className="notFound">
      <h1>404 ไม่พบหน้าที่คุณต้องการ</h1>
      <a
        className="notFound__report"
        target="_blank"
        href="https://docs.google.com/forms/d/e/1FAIpQLSdNcZF82Jq71j0_U2aCOaUQS4Cuhy0eIdl1j3cyscTvHLWm5A/viewform?usp=header"
      >
        แจ้งปัญหา
      </a>
      <Link to="/">กลับสู่หน้าหลัก</Link>
    </div>
  );
};

export default NotFound;
