import axios from "axios";

import { useState } from "react";
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
};

const PassportView = ({ bookingId }: PassportViewProps) => {
  const [isHidden, setIsHidden] = useState(true);
  const [passportData, setPassportData] = useState<PassportData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

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

  return (
    <div className="viewBooking__item">
      <span className="viewBooking__label">ข้อมูล Passport</span>
      <div
        className={
          isHidden
            ? "passportView passportView__hidden"
            : "passportView passportView__nonHidden"
        }
        onClick={fetchPassportData}
      >
        {isHidden ? (
          <>
            <i
              className={`bx ${isLoading ? "bx-loader-alt bx-spin" : "bx-lock"}`}
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
        ) : (
          passportData && (
            <div className="passportView__content">
              <div className="passportView__row">
                <span>คำนำหน้าชื่อ</span>
                <p>{passportData.namePrefix || "-"}</p>
              </div>
              <div className="passportView__row">
                <span>สัญชาติ</span>
                <p>{passportData.nationality}</p>
              </div>
              <div className="passportView__row">
                <span>เลข Passport</span>
                <p>{passportData.passportNo}</p>
              </div>
              <div className="passportView__row">
                <span>ชื่อ-นามสกุล Passport</span>
                <p>{passportData.passportName}</p>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default PassportView;
