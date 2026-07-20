import { useEffect, useState } from "react";
import axios from "axios";
import Select from "react-select";
import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";
import toast from "react-hot-toast";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import { API_URL } from "../../config/api";
import { customStyles, type OptionType } from "../../helpers/selectStyling";
import type { booking } from "../../types/bookingTypes";
import "./CorrectCheckIn.css";

countries.registerLocale(en);

type CorrectionMode = "replace_passport" | "undo_check_in";

type CorrectionWarning = { code: string; message: string };
type CorrectionError = {
  message?: string;
  preview?: { blockers?: { message: string }[] };
};

const getFlagEmoji = (code: string) =>
  code
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));

const nationalityOptions: OptionType[] = Object.entries(
  countries.getNames("en"),
).map(([code, name]) => ({
  value: code,
  label: `${name} ${getFlagEmoji(code)}`,
}));

const foreignNamePrefixOptions: OptionType[] = [
  "Mr",
  "Mrs",
  "Ms",
  "Miss",
  "Dr",
].map((value) => ({ value, label: value }));
const thaiNamePrefixOptions: OptionType[] = [
  "นาย",
  "นาง",
  "นางสาว",
  "เด็กชาย",
  "เด็กหญิง",
].map((value) => ({ value, label: value }));
const destinationCountryOptions: OptionType[] = [
  ["THA", "ไทย"],
  ["LAO", "ลาว"],
  ["VNM", "เวียดนาม"],
  ["KHM", "กัมพูชา"],
  ["MMR", "เมียนมา"],
  ["MYS", "มาเลเซีย"],
  ["SGP", "สิงคโปร์"],
  ["IDN", "อินโดนีเซีย"],
  ["PHL", "ฟิลิปปินส์"],
  ["CHN", "จีน"],
  ["JPN", "ญี่ปุ่น"],
  ["KOR", "เกาหลีใต้"],
  ["IND", "อินเดีย"],
  ["AUS", "ออสเตรเลีย"],
  ["GBR", "สหราชอาณาจักร"],
  ["USA", "สหรัฐอเมริกา"],
].map(([value, label]) => ({ value, label }));

const CorrectCheckIn = ({
  booking: currentBooking,
  mode,
  onClose,
  onUpdated,
  onDirtyChange,
}: {
  booking: booking;
  mode: CorrectionMode;
  onClose: () => void;
  onUpdated: (booking: booking) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) => {
  const [reason, setReason] = useState("");
  const [namePrefix, setNamePrefix] = useState("");
  const [nationality, setNationality] = useState("");
  const [nextDestinationCountry, setNextDestinationCountry] = useState("");
  const [passportName, setPassportName] = useState(
    currentBooking.name.trim().toUpperCase(),
  );
  const [passportNo, setPassportNo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const isThaiGuest = nationality === "TH";
  const activePrefixOptions = isThaiGuest
    ? thaiNamePrefixOptions
    : foreignNamePrefixOptions;

  useEffect(() => {
    onDirtyChange?.(
      Boolean(
        reason ||
        namePrefix ||
        nationality ||
        nextDestinationCountry ||
        passportNo ||
        passportName !== currentBooking.name.trim().toUpperCase(),
      ),
    );
    return () => onDirtyChange?.(false);
  }, [
    currentBooking.name,
    namePrefix,
    nationality,
    nextDestinationCountry,
    onDirtyChange,
    passportName,
    passportNo,
    reason,
  ]);

  const payload = () => ({
    expectedRevision: currentBooking.revision,
    mode,
    reason: reason.trim(),
    ...(mode === "replace_passport"
      ? {
          passportData: {
            namePrefix,
            passportNo,
            passportName,
            nationality,
            nextDestinationCountry,
          },
        }
      : { depositOutcome: "none" as const }),
  });
  const requestConfig = {
    withCredentials: true,
    headers: { "Idempotency-Key": idempotencyKey },
  };

  const getErrorMessage = (error: unknown) => {
    if (!axios.isAxiosError<CorrectionError>(error)) {
      return "ไม่สามารถแก้ไข Check-In ได้";
    }

    return (
      error.response?.data.preview?.blockers?.[0]?.message ||
      error.response?.data.message ||
      "ไม่สามารถแก้ไข Check-In ได้"
    );
  };

  const submit = async () => {
    if (!reason.trim()) throw new Error("กรุณาระบุเหตุผลที่แก้ไข");
    setSubmitting(true);
    try {
      const response = await axios.post<{
        booking: booking;
        message: string;
        warnings?: CorrectionWarning[];
      }>(
        `${API_URL}/bookings/${currentBooking.bookingId}/check-in-corrections`,
        payload(),
        requestConfig,
      );
      onUpdated(response.data.booking);
      response.data.warnings?.forEach((warning) =>
        toast(warning.message, { icon: "⚠️" }),
      );
      onClose();
    } catch (error) {
      throw new Error(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="correctCheckIn">
      <ModalCloseButton onClick={onClose} />
      <header>
        <h1 className="addBooking__title">
          {mode === "replace_passport" ? "แก้ข้อมูล Passport" : "Undo Check-In"}{" "}
          ของ {currentBooking.name}
        </h1>
      </header>

      {mode === "replace_passport" ? (
        <div className="correctCheckIn__passportGrid">
          <div>
            <label htmlFor="correct-check-in-passport-no">
              {isThaiGuest ? "เลขประจำตัวประชาชน" : "เลข Passport"}
            </label>
            <input
              id="correct-check-in-passport-no"
              className="boxInput"
              value={passportNo}
              inputMode={isThaiGuest ? "numeric" : undefined}
              maxLength={isThaiGuest ? 13 : undefined}
              onChange={(event) => {
                setPassportNo(
                  isThaiGuest
                    ? event.target.value.replace(/\D/g, "").slice(0, 13)
                    : event.target.value,
                );
              }}
            />
          </div>
          <div>
            <label htmlFor="correct-check-in-name-prefix">คำนำหน้าชื่อ</label>
            <Select<OptionType>
              inputId="correct-check-in-name-prefix"
              styles={customStyles<OptionType>()}
              options={activePrefixOptions}
              value={activePrefixOptions.find(
                (option) => option.value === namePrefix,
              )}
              onChange={(option) => {
                setNamePrefix(option?.value || "");
              }}
            />
          </div>
          <div className="correctCheckIn__wide">
            <label htmlFor="correct-check-in-passport-name">
              {isThaiGuest ? "ชื่อ-นามสกุลภาษาไทย" : "ชื่อบน Passport"}
            </label>
            <input
              id="correct-check-in-passport-name"
              className="boxInput"
              value={passportName}
              onChange={(event) => {
                setPassportName(
                  isThaiGuest
                    ? event.target.value
                    : event.target.value.toUpperCase(),
                );
              }}
            />
          </div>
          <div>
            <label htmlFor="correct-check-in-nationality">สัญชาติ</label>
            <Select<OptionType>
              inputId="correct-check-in-nationality"
              styles={customStyles<OptionType>()}
              options={nationalityOptions}
              value={nationalityOptions.find(
                (option) => option.value === nationality,
              )}
              onChange={(option) => {
                const value = option?.value || "";
                setNationality(value);
                setNamePrefix("");
                setPassportNo("");
              }}
            />
          </div>
          <div>
            <label htmlFor="correct-check-in-destination">
              ประเทศปลายทางถัดไป
            </label>
            <Select<OptionType>
              inputId="correct-check-in-destination"
              styles={customStyles<OptionType>()}
              options={destinationCountryOptions}
              value={destinationCountryOptions.find(
                (option) => option.value === nextDestinationCountry,
              )}
              onChange={(option) => {
                setNextDestinationCountry(option?.value || "");
              }}
            />
          </div>
        </div>
      ) : (
        <></>
      )}

      <div className="correctCheckIn__reason">
        <label htmlFor="correct-check-in-reason">เหตุผลที่แก้ไข</label>
        <textarea
          id="correct-check-in-reason"
          className="boxInput"
          value={reason}
          maxLength={500}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          placeholder="อธิบายข้อผิดพลาดโดยไม่ใส่เลข Passport หรือข้อมูลส่วนตัว"
        />
      </div>

      <div className="correctCheckIn__actions">
        <ActionButton
          text={
            mode === "replace_passport"
              ? "ยืนยันแก้ Passport"
              : "ยืนยัน Undo Check-In"
          }
          icon={mode === "replace_passport" ? "bx-save" : "bx-undo"}
          highlight
          disabled={submitting}
          onClick={() =>
            toast.promise(submit(), {
              loading: "กำลังบันทึก...",
              success: "บันทึกสำเร็จ",
              error: (error) => error.message,
            })
          }
        />
      </div>
    </div>
  );
};

export default CorrectCheckIn;
