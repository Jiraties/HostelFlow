import type { ReactNode } from "react";
import toast from "react-hot-toast";
import { Link } from "react-router";

import { useAuth } from "../context/AuthContext";

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
  const { user } = useAuth();

  const handleRefresh = () => {
    if (!onRefresh) return;

    toast.promise(Promise.resolve(onRefresh()), refreshMessages);
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

      <div className="pageHeader__profile">
        <p>
          {user?.name} {user?.admin && <strong>Admin</strong>}
        </p>
        <Link to={"/settings"}>
          <img
            className="pageHeader__profileImg"
            src={profilePictureUrl(user?.profilePictureUrl)}
            alt="profilePicture"
          />
        </Link>
      </div>
    </header>
  );
};

export default PageHeader;
