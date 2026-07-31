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

const isThaiNationality = (nationality?: string) =>
  ["TH", "THA", "THAI", "ไทย"].includes(
    nationality?.trim().toUpperCase() || "",
  );

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
  const isThaiGuest = isThaiNationality(passportData?.nationality);
  const identityDocumentLabel = isThaiGuest ? "บัตรประชาชน" : " Passport";

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
      แก้ไข
    </button>
  );

  return (
    <div className="viewBooking__item passportView__section">
      <div className="passportView__sectionHeader">
        <span className="viewBooking__label">
          {identityDocumentLabel.trim()}
        </span>
        <span className="passportView__primaryTag">
          <i className="bx bx-user" aria-hidden="true" />
          ผู้จองหลัก
        </span>
      </div>
      {isHidden ? (
        <button
          type="button"
          className="passportView passportView__hidden"
          onClick={fetchPassportData}
          disabled={isLoading}
        >
          <i
            className={`bx ${isLoading ? "bx-loader-lines bx-spin" : "bx-lock"}`}
          />
          <span>{isLoading ? "กำลังโหลด..." : "ข้อมูลถูกซ่อน"}</span>
          <small>
            {isLoading ? "โปรดรอสักครู่" : "กดเพื่อดู"}
          </small>
          {errorMessage ? (
            <small className="passportView__error">{errorMessage}</small>
          ) : null}
        </button>
      ) : (
        passportData && (
          <div className="passportView passportView__nonHidden">
            <div className="passportView__content">
              <div className="passportView__row">
                <span>
                  {isThaiGuest ? "เลขประจำตัวประชาชน" : "เลข Passport"}
                </span>
                <p>{passportData.passportNo}</p>
              </div>
              <div className="passportView__row">
                <span>
                  {isThaiGuest
                    ? "ชื่อ-นามสกุลภาษาไทย"
                    : "ชื่อ-นามสกุล Passport"}
                </span>
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
                  ซ่อน
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
