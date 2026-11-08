import { useEffect, useState } from "react";
import axios from "axios";
import Select from "../../components/MotionSelect";
import {
  nationalityOptions,
  nationalitySelectOptions,
} from "../../helpers/nationalityOptions";
import toast from "react-hot-toast";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import { API_URL } from "../../config/api";
import { effectiveTransactions } from "../../helpers/bookingHelpers";
import { customStyles, type OptionType } from "../../helpers/selectStyling";
import { uppercasePassportNumberLetters } from "../../helpers/passportNumberInput";
import type { booking } from "../../types/bookingTypes";
import "./ResolveBooking.css";
import "./CorrectBookingStatus.css";
import "./CorrectCheckIn.css";

type CorrectionMode = "replace_passport" | "undo_check_in";
type DepositOutcome = "none" | "not_received" | "refunded";
type PreviewBlocker = {
  code: string;
  message: string;
  transactionIds?: string[];
};
type CorrectionWarning = { code: string; message: string };
type PreviewResponse = {
  eligible: boolean;
  requiresAdmin: boolean;
  withinStaffShift: boolean;
  staffShiftId: string | null;
  mode: CorrectionMode;
  booking: {
    bookingId: string;
    name: string;
    status: string;
  };
  deposit: {
    remainingAmount: number;
    generatedAtCheckIn: boolean;
    requestedOutcome: DepositOutcome | null;
    message?: string;
  };
  blockers: PreviewBlocker[];
  warnings: CorrectionWarning[];
};
type CorrectionError = {
  message?: string;
  preview?: { blockers?: { message: string }[] };
};

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
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [namePrefix, setNamePrefix] = useState("");
  const [nationality, setNationality] = useState("");
  const [nextDestinationCountry, setNextDestinationCountry] = useState("");
  const [passportName, setPassportName] = useState(
    currentBooking.name.trim().toUpperCase(),
  );
  const [passportNo, setPassportNo] = useState("");
  const [depositOutcome, setDepositOutcome] = useState<DepositOutcome | "">("");
  const [refundConfirmed, setRefundConfirmed] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(mode === "undo_check_in");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const isThaiGuest = nationality === "TH";
  const passportNumberError = validationAttempted && (!passportNo.trim() || (isThaiGuest && !/^\d{13}$/.test(passportNo.trim())));
  const passportNameError = validationAttempted && (!passportName.trim() || (isThaiGuest && passportName.trim().split(/\s+/).length < 2));
  const activePrefixOptions = isThaiGuest
    ? thaiNamePrefixOptions
    : foreignNamePrefixOptions;

  const initialDepositAmount = (() => {
    const txs = effectiveTransactions(currentBooking);
    const dep = txs
      .filter((t) => t.type === "deposit")
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
    const ref = txs
      .filter((t) => t.type === "depositRefund" || t.type === "depositKept")
      .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);
    return Math.max(dep - ref, 0);
  })();
  const depositAmount = preview
    ? preview.deposit.remainingAmount
    : initialDepositAmount;
  const requiresDepositChoice = mode === "undo_check_in" && depositAmount > 0;

  useEffect(() => {
    onDirtyChange?.(
      Boolean(
        reason ||
        depositOutcome ||
        refundConfirmed ||
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
    depositOutcome,
    namePrefix,
    nationality,
    nextDestinationCountry,
    onDirtyChange,
    passportName,
    passportNo,
    reason,
    refundConfirmed,
  ]);

  useEffect(() => {
    if (mode !== "undo_check_in") return;
    let active = true;
    const loadPreview = async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const response = await axios.post<PreviewResponse>(
          `${API_URL}/bookings/${currentBooking.bookingId}/check-in-corrections/preview`,
          {
            expectedRevision: currentBooking.revision,
            mode: "undo_check_in",
            depositOutcome: requiresDepositChoice
              ? depositOutcome || undefined
              : ("none" as const),
            refundConfirmed:
              depositOutcome === "refunded" ? refundConfirmed : undefined,
          },
          {
            withCredentials: true,
            headers: { "Idempotency-Key": idempotencyKey },
          },
        );
        if (active) {
          setPreview(response.data);
        }
      } catch (error) {
        if (!active) return;
        if (axios.isAxiosError<CorrectionError>(error)) {
          setPreviewError(
            error.response?.data.message ||
              "ไม่สามารถตรวจสอบเงื่อนไขการ Undo Check-In ได้",
          );
        } else {
          setPreviewError("ไม่สามารถตรวจสอบเงื่อนไขการ Undo Check-In ได้");
        }
      } finally {
        if (active) setPreviewLoading(false);
      }
    };

    void loadPreview();
    return () => {
      active = false;
    };
  }, [
    currentBooking.bookingId,
    currentBooking.revision,
    depositOutcome,
    idempotencyKey,
    mode,
    refundConfirmed,
    requiresDepositChoice,
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
      : {
          depositOutcome: requiresDepositChoice
            ? (depositOutcome as DepositOutcome)
            : ("none" as const),
          ...(depositOutcome === "refunded" ? { refundConfirmed } : {}),
        }),
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

  const visibleBlockers = (preview?.blockers || []).filter(
    (blocker) =>
      blocker.code !== "DEPOSIT_OUTCOME_REQUIRED" &&
      blocker.code !== "DEPOSIT_REFUND_CONFIRMATION_REQUIRED",
  );
  const canSubmitUndo =
    !previewLoading &&
    !previewError &&
    visibleBlockers.length === 0 &&
    (!requiresDepositChoice ||
      depositOutcome === "not_received" ||
      (depositOutcome === "refunded" && refundConfirmed));

  const submit = async () => {
    setValidationAttempted(true);
    if (!reason.trim()) throw new Error("กรุณาระบุเหตุผลที่แก้ไข");
    if (mode === "undo_check_in") {
      if (requiresDepositChoice && !depositOutcome) {
        throw new Error("กรุณาเลือกสิ่งที่เกิดขึ้นจริงกับเงินมัดจำ");
      }
      if (
        requiresDepositChoice &&
        depositOutcome === "refunded" &&
        !refundConfirmed
      ) {
        throw new Error(
          `กรุณายืนยันว่าได้คืนเงินสด ฿${depositAmount.toLocaleString("th-TH")} ให้แขกจริงแล้ว`,
        );
      }
      if (visibleBlockers.length > 0) {
        throw new Error(visibleBlockers[0].message);
      }
    }
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
              aria-invalid={passportNumberError}
              aria-describedby={passportNumberError ? "correct-check-in-number-error" : undefined}
              value={passportNo}
              inputMode={isThaiGuest ? "numeric" : undefined}
              maxLength={isThaiGuest ? 13 : undefined}
              onChange={(event) => {
                setPassportNo(
                  isThaiGuest
                    ? event.target.value.replace(/\D/g, "").slice(0, 13)
                    : uppercasePassportNumberLetters(event.target.value),
                );
              }}
            />
            {passportNumberError && <p id="correct-check-in-number-error" className="formField__error">{isThaiGuest ? "กรุณากรอกเลขประจำตัวประชาชน 13 หลัก" : "กรุณากรอกเลข Passport"}</p>}
          </div>
          <div>
            <label htmlFor="correct-check-in-name-prefix">คำนำหน้าชื่อ</label>
            <Select<OptionType>
              inputId="correct-check-in-name-prefix"
              styles={customStyles<OptionType>()}
              classNamePrefix="rs"
              className={validationAttempted && !namePrefix ? "formField--error" : undefined}
              aria-invalid={validationAttempted && !namePrefix}
              aria-errormessage={validationAttempted && !namePrefix ? "correct-check-in-prefix-error" : undefined}
              options={activePrefixOptions}
              value={activePrefixOptions.find(
                (option) => option.value === namePrefix,
              )}
              onChange={(option) => {
                setNamePrefix(option?.value || "");
              }}
            />
            {validationAttempted && !namePrefix && <p id="correct-check-in-prefix-error" className="formField__error">กรุณาเลือกคำนำหน้าชื่อ</p>}
          </div>
          <div className="correctCheckIn__wide">
            <label htmlFor="correct-check-in-passport-name">
              {isThaiGuest ? "ชื่อ-นามสกุลภาษาไทย" : "ชื่อบน Passport"}
            </label>
            <input
              id="correct-check-in-passport-name"
              className="boxInput"
              aria-invalid={passportNameError}
              aria-describedby={passportNameError ? "correct-check-in-name-error" : undefined}
              value={passportName}
              onChange={(event) => {
                setPassportName(
                  isThaiGuest
                    ? event.target.value
                    : event.target.value.toUpperCase(),
                );
              }}
            />
            {passportNameError && <p id="correct-check-in-name-error" className="formField__error">กรุณากรอกชื่อและนามสกุล</p>}
          </div>
          <div>
            <label htmlFor="correct-check-in-nationality">สัญชาติ</label>
            <Select<OptionType>
              inputId="correct-check-in-nationality"
              styles={customStyles<OptionType>()}
              classNamePrefix="rs"
              className={validationAttempted && !nationality ? "formField--error" : undefined}
              aria-invalid={validationAttempted && !nationality}
              aria-errormessage={validationAttempted && !nationality ? "correct-check-in-nationality-error" : undefined}
              options={nationalitySelectOptions}
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
            {validationAttempted && !nationality && <p id="correct-check-in-nationality-error" className="formField__error">กรุณาเลือกสัญชาติ</p>}
          </div>
          <div>
            <label htmlFor="correct-check-in-destination">
              ประเทศปลายทางถัดไป
            </label>
            <Select<OptionType>
              inputId="correct-check-in-destination"
              styles={customStyles<OptionType>()}
              classNamePrefix="rs"
              className={validationAttempted && !nextDestinationCountry ? "formField--error" : undefined}
              aria-invalid={validationAttempted && !nextDestinationCountry}
              aria-errormessage={validationAttempted && !nextDestinationCountry ? "correct-check-in-destination-error" : undefined}
              options={destinationCountryOptions}
              value={destinationCountryOptions.find(
                (option) => option.value === nextDestinationCountry,
              )}
              onChange={(option) => {
                setNextDestinationCountry(option?.value || "");
              }}
            />
            {validationAttempted && !nextDestinationCountry && <p id="correct-check-in-destination-error" className="formField__error">กรุณาเลือกประเทศปลายทางถัดไป</p>}
          </div>
        </div>
      ) : (
        <div className="correctCheckIn__undoFlow">
          {requiresDepositChoice && (
            <fieldset className="correctBookingStatus__deposit formChoiceGroup">
              <legend>
                เกิดอะไรขึ้นกับมัดจำ ฿{depositAmount.toLocaleString("th-TH")}?
              </legend>
              <label className="formChoice">
                <span className="formChoice__copy">
                  <span className="formChoice__title">ยังไม่ได้รับมัดจำ</span>
                  <small>แก้ยอดมัดจำเป็น 0 บาท โดยเก็บประวัติเดิม</small>
                </span>
                <input
                  type="radio"
                  name="checkInDepositOutcome"
                  checked={depositOutcome === "not_received"}
                  onChange={() => {
                    setDepositOutcome("not_received");
                    setRefundConfirmed(false);
                  }}
                />
                <i className="bx bx-check formChoice__indicator" aria-hidden="true" />
              </label>
              <label className="formChoice">
                <span className="formChoice__copy">
                  <span className="formChoice__title">คืนมัดจำเป็นเงินสดแล้ว</span>
                  <small>บันทึกการคืนมัดจำ โดยเก็บรายการรับเงินเดิม</small>
                </span>
                <input
                  type="radio"
                  name="checkInDepositOutcome"
                  checked={depositOutcome === "refunded"}
                  onChange={() => setDepositOutcome("refunded")}
                />
                <i className="bx bx-check formChoice__indicator" aria-hidden="true" />
              </label>
              {depositOutcome === "refunded" && (
                <label className="checkbox correctCheckIn__confirmCheckbox">
                  <input
                    type="checkbox"
                    checked={refundConfirmed}
                    onChange={(event) =>
                      setRefundConfirmed(event.target.checked)
                    }
                  />
                  <span className="box" aria-hidden="true" />
                  <span>
                    ยืนยันว่าคืนเงินสด ฿
                    {depositAmount.toLocaleString("th-TH")} ให้แขกแล้ว
                  </span>
                </label>
              )}
            </fieldset>
          )}

          <div>
            <p className="addBooking__label">หลังยืนยัน</p>
            <section
              className="resolveBooking__summary correctBookingStatus__summary"
              aria-live="polite"
            >
              {previewLoading ? (
                <p>กำลังตรวจสอบ...</p>
              ) : previewError ? (
                <p className="correctBookingStatus__warning">{previewError}</p>
              ) : (
                <>
                  <ul>
                    <li>Booking กลับเป็น <strong>จองแล้ว</strong></li>
                    <li>ลบข้อมูลการเช็คอินและ Passport</li>
                    {requiresDepositChoice && depositOutcome === "not_received" && (
                      <li>แก้ยอดมัดจำเป็น 0 บาท</li>
                    )}
                    {requiresDepositChoice && depositOutcome === "refunded" && (
                      <li>บันทึกคืนมัดจำเงินสด ฿{depositAmount.toLocaleString("th-TH")}</li>
                    )}
                    {requiresDepositChoice && !depositOutcome && (
                      <li>เลือกสถานะมัดจำก่อนยืนยัน</li>
                    )}
                  </ul>
                  {preview?.warnings?.map((warning) => (
                    <p
                      key={warning.code}
                      className="correctBookingStatus__warning"
                    >
                      {warning.message}
                    </p>
                  ))}
                  {visibleBlockers.length > 0 && (
                    <div className="correctBookingStatus__blockers">
                      <strong>ยังไม่สามารถ Undo Check-In ได้</strong>
                      <ul>
                        {visibleBlockers.map((blocker) => (
                          <li key={blocker.code}>{blocker.message}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      )}

      <div className="correctCheckIn__reason">
        <label htmlFor="correct-check-in-reason">เหตุผลที่แก้ไข</label>
        <textarea
          id="correct-check-in-reason"
          className="boxInput"
          aria-invalid={validationAttempted && !reason.trim()}
          aria-describedby={validationAttempted && !reason.trim() ? "correct-check-in-reason-error" : undefined}
          value={reason}
          maxLength={500}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          placeholder="ระบุเหตุผล โดยไม่ใส่ข้อมูลส่วนตัว"
        />
        {validationAttempted && !reason.trim() && <p id="correct-check-in-reason-error" className="formField__error">กรุณาระบุเหตุผลที่แก้ไข</p>}
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
          disabled={
            submitting ||
            (mode === "undo_check_in" && !canSubmitUndo)
          }
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
