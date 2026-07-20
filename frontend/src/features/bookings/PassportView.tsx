import axios from "axios";

import { useEffect, useState } from "react";
import Tooltip from "../../components/Tooltip";
import { API_URL } from "../../config/api.ts";

import "./PassportView.css";

type PassportData = {
  namePrefix?: string;
  nationality: string;
  passportNo: string;
  passportName: string;
};

type PassportViewProps = {
  bookingId: string;
  correctionDisabled?: boolean;
  correctionDisabledReason?: string;
  onCorrectPassport: () => void;
};

const PassportView = ({
  bookingId,
  correctionDisabled = false,
  correctionDisabledReason,
  onCorrectPassport,
}: PassportViewProps) => {
  const [isHidden, setIsHidden] = useState(true);
  const [passportData, setPassportData] = useState<PassportData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const hidePassportData = () => {
    setPassportData(null);
    setIsHidden(true);
  };

  useEffect(() => {
    if (!passportData) return;
    const timeout = window.setTimeout(hidePassportData, 60_000);
    return () => window.clearTimeout(timeout);
  }, [passportData]);

  const fetchPassportData = async () => {
    if (isLoading || passportData) return;

    try {
      setIsLoading(true);
      setErrorMessage("");

      const response = await axios.get<{ passportData: PassportData }>(
        `${API_URL}/bookings/getPassportData/${bookingId}`,
        { withCredentials: true },
      );

      setPassportData(response.data.passportData);
      setIsHidden(false);
    } catch (err) {
      const message = axios.isAxiosError<{ message?: string }>(err)
        ? err.response?.data.message
        : null;

      setErrorMessage(message || "ไม่สามารถโหลดข้อมูล Passport ได้");
    } finally {
      setIsLoading(false);
    }
  };

  const correctionButton = (
    <button
      type="button"
      className="passportView__hideButton passportView__correctButton"
      onClick={onCorrectPassport}
      disabled={correctionDisabled}
    >
      <i
        className={`bx bx-edit${
          correctionDisabled ? "" : " passportView__temporaryEditIcon"
        }`}
      />
      แก้ข้อมูล Passport
    </button>
  );

  return (
    <div className="viewBooking__item">
      <span className="viewBooking__label">ข้อมูล Passport</span>
      {isHidden ? (
        <button
          type="button"
          className="passportView passportView__hidden"
          onClick={fetchPassportData}
          disabled={isLoading}
        >
          <>
            <i
              className={`bx ${isLoading ? "bx-loader-lines bx-spin" : "bx-lock"}`}
            />
            <p>
              {isLoading
                ? "กำลังโหลดข้อมูล Passport"
                : "กดเพื่อดูข้อมูล Passport"}
            </p>
            {errorMessage && (
              <p className="passportView__error">{errorMessage}</p>
            )}
          </>
        </button>
      ) : (
        passportData && (
          <div className="passportView passportView__nonHidden">
            <div className="passportView__content">
              <div className="passportView__row">
                <span>เลข Passport</span>
                <p>{passportData.passportNo}</p>
              </div>
              <div className="passportView__row">
                <span>ชื่อ-นามสกุล Passport</span>
                <p>
                  {passportData.namePrefix || "-"} {passportData.passportName}
                </p>
              </div>{" "}
              <div className="passportView__row">
                <span>สัญชาติ</span>
                <p>{passportData.nationality}</p>
              </div>
              <div className="passportView__actions">
                {correctionDisabled ? (
                  <Tooltip
                    content={
                      correctionDisabledReason ||
                      "รายการนี้ต้องให้ Admin ดำเนินการ"
                    }
                    ariaLabel="เหตุผลที่ไม่สามารถแก้ข้อมูล Passport ได้"
                  >
                    {correctionButton}
                  </Tooltip>
                ) : (
                  correctionButton
                )}
                <button
                  type="button"
                  className="passportView__hideButton"
                  onClick={hidePassportData}
                >
                  <i className="bx bx-eye-slash" />
                  ซ่อนข้อมูล Passport
                </button>
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
};

export default PassportView;
