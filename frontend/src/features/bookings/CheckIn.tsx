import { useState, useEffect, useId } from "react";
import type { booking } from "../../types/bookingTypes";
import "./BookingCheckbox.css";
import "./CheckIn.css";
import Select from "../../components/MotionSelect";
import {
  nationalityOptions,
  nationalitySelectOptions,
} from "../../helpers/nationalityOptions";
import { customStyles } from "../../helpers/selectStyling";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import CashShiftNudge from "../../components/CashShiftNudge";
import { roomChargeOutstandingAmount } from "../../helpers/bookingHelpers";
import type { OptionType } from "../../helpers/selectStyling";
import axios from "axios";
import toast from "react-hot-toast";
import { API_URL } from "../../config/api";
import { getApiErrorMessage } from "../../helpers/apiErrorMessage";
import { uppercasePassportNumberLetters } from "../../helpers/passportNumberInput";
import "./CheckOut.css";

const paymentMethodOptions = [
  { value: "Cash", label: "Cash" },
  { value: "Card", label: "Card" },
  { value: "Transfer", label: "Transfer" },
];

const foreignNamePrefixOptions: OptionType[] = [
  { value: "Mr", label: "Mr" },
  { value: "Mrs", label: "Mrs" },
  { value: "Ms", label: "Ms" },
  { value: "Miss", label: "Miss" },
  { value: "Dr", label: "Dr" },
];

const thaiNamePrefixOptions: OptionType[] = [
  { value: "นาย", label: "นาย" },
  { value: "นาง", label: "นาง" },
  { value: "นางสาว", label: "นางสาว" },
  { value: "เด็กชาย", label: "เด็กชาย" },
  { value: "เด็กหญิง", label: "เด็กหญิง" },
];

const splitGuestName = (name: string) => {
  const parts = name.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);

  return {
    firstName: parts[0] || "",
    middleName: parts.slice(1, -1).join(" "),
    lastName: parts.length > 1 ? parts[parts.length - 1] : "",
  };
};

const destinationCountryOptions: OptionType[] = [
  { value: "THA", label: "ไทย" },
  { value: "LAO", label: "ลาว" },
  { value: "VNM", label: "เวียดนาม" },
  { value: "KHM", label: "กัมพูชา" },
  { value: "MMR", label: "เมียนมา" },
  { value: "MYS", label: "มาเลเซีย" },
  { value: "SGP", label: "สิงคโปร์" },
  { value: "IDN", label: "อินโดนีเซีย" },
  { value: "PHL", label: "ฟิลิปปินส์" },
  { value: "CHN", label: "จีน" },
  { value: "JPN", label: "ญี่ปุ่น" },
  { value: "KOR", label: "เกาหลีใต้" },
  { value: "IND", label: "อินเดีย" },
  { value: "AUS", label: "ออสเตรเลีย" },
  { value: "GBR", label: "สหราชอาณาจักร" },
  { value: "USA", label: "สหรัฐอเมริกา" },
];

type CheckInPayload = {
  expectedRevision: number;
  deposit: number;
  adminHistoricalCheckIn?: boolean;
  passportData: {
    namePrefix: string;
    passportNo: string;
    passportName: string;
    nationality: string;
    nextDestinationCountry: string;
  };
  unpaidPayment?: {
    paymentMethod: string;
    roundingAdjustment: number;
  };
};

const CheckIn = ({
  booking,
  isLateCheckIn,
  nightsLate,
  adminHistoricalCheckIn = false,
  handleCheckInSuccess,
  onClose,
  onDirtyChange,
}: {
  booking: booking;
  isLateCheckIn?: boolean;
  nightsLate?: number;
  adminHistoricalCheckIn?: boolean;
  handleCheckInSuccess: (booking: booking) => void;
  onClose?: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
}) => {
  const outstandingRoomChargeAmount = roomChargeOutstandingAmount(booking);
  const hasOutstandingRoomCharge = outstandingRoomChargeAmount > 0;
  const existingDepositTransactions = booking.transactions.filter(
    (transaction) => transaction.type === "deposit",
  );
  const existingDepositAmount = Math.max(
    booking.transactions.reduce((total, transaction) => {
      if (transaction.type === "deposit") return total + transaction.amount;
      if (
        transaction.type === "depositRefund" ||
        transaction.type === "depositKept"
      ) {
        return total - transaction.amount;
      }
      return total;
    }, 0),
    0,
  );
  const hasExistingDeposit = existingDepositAmount > 0;
  const initialDepositAmount = hasExistingDeposit ? existingDepositAmount : 200;

  const [deposit, setDeposit] = useState<number | "">(initialDepositAmount);
  const [unpaidPaymentPaymentMethod, setUnpaidPaymentPaymentMethod] =
    useState<string>("Cash");
  const [confirmedPayment, setConfirmedPayment] = useState<boolean>(false);
  const [namePrefix, setNamePrefix] = useState<string>("");
  const [nationality, setNationality] = useState<string>("");
  const [nextDestinationCountry, setNextDestinationCountry] =
    useState<string>("");
  const [passportName, setPassportName] = useState<string>(
    booking.name.trim().toUpperCase(),
  );
  const [passportNo, setPassportNo] = useState<string>("");
  const [roundingAdjustment, setRoundingAdjustment] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const fieldId = useId();
  const [adjustedRoomChargeInput, setAdjustedRoomChargeInput] = useState<string>(
    String(outstandingRoomChargeAmount),
  );
  const isThaiGuest = nationality === "TH";
  const activeNamePrefixOptions = isThaiGuest
    ? thaiNamePrefixOptions
    : foreignNamePrefixOptions;
  const thaiNameParts = splitGuestName(passportName);

  useEffect(() => {
    setAdjustedRoomChargeInput(String(outstandingRoomChargeAmount));
  }, [outstandingRoomChargeAmount]);

  useEffect(() => {
    onDirtyChange?.(
      Boolean(
        namePrefix ||
        nationality ||
        nextDestinationCountry ||
        passportName ||
        passportNo ||
        deposit !== initialDepositAmount ||
        unpaidPaymentPaymentMethod !== "Cash" ||
        confirmedPayment ||
        roundingAdjustment ||
        adjustedRoomChargeInput !== String(outstandingRoomChargeAmount),
      ),
    );

    return () => onDirtyChange?.(false);
  }, [
    confirmedPayment,
    deposit,
    initialDepositAmount,
    namePrefix,
    nationality,
    nextDestinationCountry,
    onDirtyChange,
    passportName,
    passportNo,
    adjustedRoomChargeInput,
    outstandingRoomChargeAmount,
    roundingAdjustment,
    unpaidPaymentPaymentMethod,
  ]);

  const formatCurrency = (num: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      minimumFractionDigits: num % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
      currency: "THB",
    }).format(num);

  const parsedAdjustedRoomChargeAmount = Number(adjustedRoomChargeInput);
  const cashRoundingEnabled =
    roundingAdjustment &&
    hasOutstandingRoomCharge &&
    unpaidPaymentPaymentMethod === "Cash";
  const adjustedRoomChargeAmount =
    cashRoundingEnabled &&
    Number.isFinite(parsedAdjustedRoomChargeAmount) &&
    parsedAdjustedRoomChargeAmount >= outstandingRoomChargeAmount
      ? parsedAdjustedRoomChargeAmount
      : outstandingRoomChargeAmount;
  const cardSurcharge =
    hasOutstandingRoomCharge && unpaidPaymentPaymentMethod === "Card"
      ? Number((adjustedRoomChargeAmount * 0.03).toFixed(2))
      : 0;

  // --- CLEAN MATH FOR THE UI TOTALS ---
  let cashTotal = hasExistingDeposit ? 0 : Number(deposit) || 0;
  if (
    hasOutstandingRoomCharge &&
    unpaidPaymentPaymentMethod === "Cash"
  ) {
    cashTotal += adjustedRoomChargeAmount;
  }
  const depositCash = hasExistingDeposit ? 0 : Number(deposit) || 0;
  const hasCashMovement = cashTotal - depositCash > 0;
  const hasPaymentToConfirm =
    !hasExistingDeposit || hasOutstandingRoomCharge;

  // Keep the existing submission rules while showing the affected fields in place.
  const fieldErrors = validationAttempted
    ? {
        passportNo: !passportNo
          ? "กรุณากรอกเลขประจำตัวประชาชนหรือเลข Passport"
          : isThaiGuest && !/^\d{13}$/.test(passportNo)
            ? "เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก"
            : "",
        namePrefix: !namePrefix ? "กรุณาเลือกคำนำหน้าชื่อ" : "",
        passportName:
          !passportName ||
          (isThaiGuest && (!thaiNameParts.firstName || !thaiNameParts.lastName))
            ? "กรุณากรอกชื่อและนามสกุล"
            : "",
        nationality: !nationality ? "กรุณาเลือกสัญชาติ" : "",
        destination: !nextDestinationCountry
          ? "กรุณาเลือกประเทศปลายทางถัดไป"
          : "",
        deposit: deposit === "" || Number.isNaN(deposit)
          ? "กรุณากรอกยอดมัดจำ"
          : "",
        payment: hasPaymentToConfirm && !confirmedPayment
          ? adminHistoricalCheckIn
            ? "กรุณายืนยันยอดเงินที่รับไว้ก่อนเริ่มใช้ระบบ"
            : "กรุณายืนยันยอดชำระจากลูกค้า"
          : "",
        adjustedAmount:
          hasOutstandingRoomCharge && cashRoundingEnabled &&
          (!Number.isFinite(parsedAdjustedRoomChargeAmount) ||
            parsedAdjustedRoomChargeAmount < outstandingRoomChargeAmount)
            ? "ยอดชำระค่าห้องหลังปรับต้องไม่ต่ำกว่าค่าห้อง"
            : "",
      }
    : null;

  const checkInHandler = async () => {
    setValidationAttempted(true);
    if (
      !namePrefix ||
      !nationality ||
      !nextDestinationCountry ||
      !passportName ||
      (isThaiGuest && (!thaiNameParts.firstName || !thaiNameParts.lastName)) ||
      !passportNo ||
      deposit === "" ||
      Number.isNaN(deposit)
    ) {
      throw new Error("กรุณากรอกข้อมูลให้ครบทุกช่อง");
    }

    if (isThaiGuest && !/^\d{13}$/.test(passportNo)) {
      throw new Error("เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก");
    }

    if (hasPaymentToConfirm && !confirmedPayment) {
      throw new Error(
        adminHistoricalCheckIn
          ? "กรุณายืนยันยอดเงินที่รับไว้ก่อนเริ่มใช้ระบบ"
          : "กรุณายืนยันยอดชำระจากลูกค้า",
      );
    }

    if (
      hasOutstandingRoomCharge &&
      cashRoundingEnabled &&
      (!Number.isFinite(parsedAdjustedRoomChargeAmount) ||
        parsedAdjustedRoomChargeAmount < outstandingRoomChargeAmount)
    ) {
      throw new Error("ยอดชำระค่าห้องหลังปรับต้องไม่ต่ำกว่าค่าห้อง");
    }

    setSubmitting(true);

    try {
      // Dynamically build payload to preserve the selected payment method!
      const payload: CheckInPayload = {
        expectedRevision: booking.revision,
        deposit: Number(deposit),
        adminHistoricalCheckIn,
        passportData: {
          namePrefix,
          passportNo,
          passportName,
          nationality,
          nextDestinationCountry,
        },
      };

      if (hasOutstandingRoomCharge) {
        payload.unpaidPayment = {
          paymentMethod: unpaidPaymentPaymentMethod,
          roundingAdjustment: cashRoundingEnabled
            ? parsedAdjustedRoomChargeAmount - outstandingRoomChargeAmount
            : 0,
        };
      }

      const response = await axios.put(
        `${API_URL}/bookings/checkIn/${booking?.bookingId}`,
        payload,
        { withCredentials: true },
      );

      if (response.status === 200) {
        handleCheckInSuccess(response.data);
      }

      return response;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="checkIn__wrapper">
      {onClose && <ModalCloseButton onClick={onClose} />}
      <div>
        <div className="checkIn__header">
          <h1 className="checkIn__title">เช็คอิน {booking.name}</h1>
          {(adminHistoricalCheckIn ||
            isLateCheckIn ||
            hasOutstandingRoomCharge ||
            hasCashMovement) && (
            <div className="bookingNoticeStack">
              {adminHistoricalCheckIn && (
                <div className="checkIn__reminder checkOut__earlyReminder">
                  <i className="bx bx-history" />
                  <p>
                    โหมดชั่วคราวสำหรับ Admin: ระบบจะลงวันที่ check-in และรายการเงิน
                    เป็นวันเข้าพักเดิม โดยไม่เพิ่มเงินเข้ากะปัจจุบัน
                    <strong>
                      กรุณารวมมัดจำที่ถืออยู่ในยอดเงินมัดจำเริ่มต้นของวันเปิดระบบ
                    </strong>
                  </p>
                </div>
              )}
              {isLateCheckIn && (
                <div className="checkIn__reminder checkOut__earlyReminder">
                  <i className="bx bx-message-bubble-exclamation" />
                  <p>
                    ลูกค้าดังกล่าวเช็คอินล่าช้า{" "}
                    <strong>{nightsLate || 0} คืน</strong>
                  </p>
                </div>
              )}
              {hasOutstandingRoomCharge && (
                <div className="checkIn__reminder">
                  <i className="bx bx-message-bubble-exclamation" />
                  <p>
                    ลูกค้าดังกล่าว
                    <strong>
                      ยังไม่ชำระเงินค่าห้อง
                      {" " + formatCurrency(outstandingRoomChargeAmount)}
                    </strong>
                  </p>
                </div>
              )}
              {hasCashMovement && !adminHistoricalCheckIn && <CashShiftNudge />}
            </div>
          )}
        </div>
      </div>
      <div className="checkIn__grid">
        <div className="checkIn__left">
          <div>
            {" "}
            <label className="checkIn__label" htmlFor={`${fieldId}-passport`}>
              {isThaiGuest ? "เลขประจำตัวประชาชน" : "เลข Passport"}{" "}
              <i className="bx bx-check-shield" />
            </label>
            <input
              id={`${fieldId}-passport`}
              type="text"
              value={passportNo}
              onChange={(e) =>
                setPassportNo(
                  isThaiGuest
                    ? e.target.value.replace(/\D/g, "").slice(0, 13)
                    : uppercasePassportNumberLetters(e.target.value),
                )
              }
              inputMode={isThaiGuest ? "numeric" : undefined}
              maxLength={isThaiGuest ? 13 : undefined}
              className={`boxInput${fieldErrors?.passportNo ? " boxInput--error" : ""}`}
              aria-invalid={Boolean(fieldErrors?.passportNo)}
              aria-describedby={fieldErrors?.passportNo ? `${fieldId}-passport-error` : undefined}
              placeholder={isThaiGuest ? "เลข 13 หลัก" : "เช่น A12345678"}
            />
            {fieldErrors?.passportNo && <p id={`${fieldId}-passport-error`} className="formField__error">{fieldErrors.passportNo}</p>}
          </div>
          <div className="checkIn__nameRow">
            <div className="checkIn__prefixField">
              <label className="checkIn__label" htmlFor={`${fieldId}-prefix`}>คำนำหน้าชื่อ</label>
              <Select<OptionType>
                inputId={`${fieldId}-prefix`}
                className={fieldErrors?.namePrefix ? "formField--error" : undefined}
                classNamePrefix="rs"
                aria-invalid={Boolean(fieldErrors?.namePrefix)}
                aria-errormessage={fieldErrors?.namePrefix ? `${fieldId}-prefix-error` : undefined}
                styles={customStyles<OptionType>()}
                options={activeNamePrefixOptions}
                value={activeNamePrefixOptions.find(
                  (option) => option.value === namePrefix,
                )}
                onChange={(option) => setNamePrefix(option?.value || "")}
                placeholder="เลือก"
              />
              {fieldErrors?.namePrefix && <p id={`${fieldId}-prefix-error`} className="formField__error">{fieldErrors.namePrefix}</p>}
            </div>
            <div className="checkIn__passportNameField">
              <label className="checkIn__label" htmlFor={`${fieldId}-name`}>
                {isThaiGuest ? "ชื่อ-นามสกุลภาษาไทย" : "ชื่อ-นามสกุล Passport"}{" "}
                <i className="bx bx-check-shield" />
              </label>
              <input
                id={`${fieldId}-name`}
                type="text"
                value={passportName}
                onChange={(e) =>
                  setPassportName(
                    isThaiGuest ? e.target.value : e.target.value.toUpperCase(),
                  )
                }
                className={`boxInput${fieldErrors?.passportName ? " boxInput--error" : ""}`}
                aria-invalid={Boolean(fieldErrors?.passportName)}
                aria-describedby={fieldErrors?.passportName ? `${fieldId}-name-error` : undefined}
                placeholder={
                  isThaiGuest ? "เช่น สมชาย กลาง ใจดี" : "เช่น ROBERT BROWN"
                }
              />
              {fieldErrors?.passportName && <p id={`${fieldId}-name-error`} className="formField__error">{fieldErrors.passportName}</p>}
            </div>
          </div>
          <div>
            <label className="checkIn__label" htmlFor={`${fieldId}-nationality`}>สัญชาติ</label>
            <Select<OptionType>
              inputId={`${fieldId}-nationality`}
              className={fieldErrors?.nationality ? "formField--error" : undefined}
              classNamePrefix="rs"
              aria-invalid={Boolean(fieldErrors?.nationality)}
              aria-errormessage={fieldErrors?.nationality ? `${fieldId}-nationality-error` : undefined}
              styles={customStyles<OptionType>()}
              options={nationalitySelectOptions}
              value={nationalityOptions.find(
                (option) => option.value === nationality,
              )}
              onChange={(option) => {
                const nextNationality = option?.value || "";
                const nextIsThai = nextNationality === "TH";
                const nextPrefixOptions = nextIsThai
                  ? thaiNamePrefixOptions
                  : foreignNamePrefixOptions;

                if (
                  namePrefix &&
                  !nextPrefixOptions.some(
                    (prefixOption) => prefixOption.value === namePrefix,
                  )
                ) {
                  setNamePrefix("");
                }

                if (nextIsThai !== isThaiGuest) {
                  setPassportNo("");
                }
                setNationality(nextNationality);
              }}
            />
            {fieldErrors?.nationality && <p id={`${fieldId}-nationality-error`} className="formField__error">{fieldErrors.nationality}</p>}
          </div>
          <div>
            <label className="checkIn__label" htmlFor={`${fieldId}-destination`}>ประเทศปลายทางถัดไป</label>
            <Select<OptionType>
              inputId={`${fieldId}-destination`}
              className={fieldErrors?.destination ? "formField--error" : undefined}
              classNamePrefix="rs"
              aria-invalid={Boolean(fieldErrors?.destination)}
              aria-errormessage={fieldErrors?.destination ? `${fieldId}-destination-error` : undefined}
              styles={customStyles<OptionType>()}
              options={destinationCountryOptions}
              value={destinationCountryOptions.find(
                (option) => option.value === nextDestinationCountry,
              )}
              onChange={(option) =>
                setNextDestinationCountry(option?.value || "")
              }
              placeholder="เลือกประเทศที่จะเดินทางต่อ"
            />
            {fieldErrors?.destination && <p id={`${fieldId}-destination-error`} className="formField__error">{fieldErrors.destination}</p>}
          </div>
        </div>
        <div className="checkIn__right">
          <div>
              <label className="checkIn__label" htmlFor={`${fieldId}-deposit`}>
                {adminHistoricalCheckIn
                  ? "มัดจำที่รับไว้ก่อนเริ่มระบบ (บาท)"
                  : "มัดจำ (บาท)"}
              </label>
            <input
              id={`${fieldId}-deposit`}
              className={`boxInput${fieldErrors?.deposit ? " boxInput--error" : ""}`}
              aria-invalid={Boolean(fieldErrors?.deposit)}
              aria-describedby={fieldErrors?.deposit ? `${fieldId}-deposit-error` : undefined}
              type="number"
              max={1000}
              min={0}
              value={deposit}
              disabled={hasExistingDeposit}
              placeholder="200"
              onChange={(e) => {
                setDeposit(e.target.value === "" ? "" : Number(e.target.value));
                setConfirmedPayment(false);
              }}
            />
            {fieldErrors?.deposit && <p id={`${fieldId}-deposit-error`} className="formField__error">{fieldErrors.deposit}</p>}
            {hasExistingDeposit && (
              <p className="checkIn__label">
                รับมัดจำรายการนี้ไว้แล้ว ระบบจะนำมาใช้กับการ check-in
              </p>
            )}
          </div>

          {hasOutstandingRoomCharge && (
            <div>
              <label className="checkIn__label" htmlFor={`${fieldId}-payment-method`}>ช่องทางการจ่ายค่าห้อง</label>
              <Select<OptionType>
                inputId={`${fieldId}-payment-method`}
                styles={customStyles<OptionType>()}
                options={paymentMethodOptions}
                value={paymentMethodOptions.find(
                  (option) => option.value === unpaidPaymentPaymentMethod,
                )}
                onChange={(option) => {
                  setConfirmedPayment(false);
                  const paymentMethod = option?.value || "";
                  setUnpaidPaymentPaymentMethod(paymentMethod);
                  if (paymentMethod !== "Cash") {
                    setRoundingAdjustment(false);
                    setAdjustedRoomChargeInput(String(outstandingRoomChargeAmount));
                  }
                }}
              />
            </div>
          )}

          {cashRoundingEnabled && (
            <div>
              <label className="checkIn__label" htmlFor={`${fieldId}-adjusted-amount`}>
                ยอดชำระค่าห้องหลังปรับ (บาท)
              </label>
              <input
                id={`${fieldId}-adjusted-amount`}
                className={`boxInput${fieldErrors?.adjustedAmount ? " boxInput--error" : ""}`}
                aria-invalid={Boolean(fieldErrors?.adjustedAmount)}
                aria-describedby={fieldErrors?.adjustedAmount ? `${fieldId}-adjusted-error` : undefined}
                type="number"
                min={outstandingRoomChargeAmount}
                step="0.01"
                value={adjustedRoomChargeInput}
                placeholder="200"
                onChange={(e) => {
                  setAdjustedRoomChargeInput(e.target.value);
                  setConfirmedPayment(false);
                }}
              />
              {fieldErrors?.adjustedAmount && <p id={`${fieldId}-adjusted-error`} className="formField__error">{fieldErrors.adjustedAmount}</p>}
            </div>
          )}

          <div>
            <p style={{ marginBottom: ".5rem" }}>สรุปยอดการชำระเงิน</p>
            <div className="checkIn__paymentConfirmation">
              <div className="checkIn__paymentConfirmationList">
                {/* Deposit Row */}
                <div className="checkIn__paymentRow">
                  <p>
                    ค่ามัดจำ{" "}
                    <span
                      className={`checkIn__paymentTag ${(
                        existingDepositTransactions[0]?.paymentMethod || "Cash"
                      ).toLowerCase()}`}
                    >
                      {existingDepositTransactions[0]?.paymentMethod || "Cash"}
                    </span>
                    {hasExistingDeposit && " · รับแล้ว"}
                  </p>
                  <p>{formatCurrency(Number(deposit))}</p>
                </div>

                {/* Room Charge Row */}
                {hasOutstandingRoomCharge && (
                  <div className="checkIn__paymentRow">
                    <p>
                      ค่าห้อง{" "}
                      <span
                        className={`checkIn__paymentTag ${unpaidPaymentPaymentMethod.toLowerCase()}`}
                      >
                        {unpaidPaymentPaymentMethod}
                      </span>
                    </p>
                    <p>
                      {formatCurrency(outstandingRoomChargeAmount)}
                      {cashRoundingEnabled && (
                        <span className="checkIn__extraAmountReceived">
                          {` + เกิน ${formatCurrency(adjustedRoomChargeAmount - outstandingRoomChargeAmount)}`}
                        </span>
                      )}
                    </p>
                  </div>
                )}

                {cardSurcharge > 0 && (
                  <div className="checkIn__paymentRow">
                    <p>
                      ค่าธรรมเนียมบัตร 3%{" "}
                      <span className="checkIn__paymentTag card">Card</span>
                    </p>
                    <p>{formatCurrency(cardSurcharge)}</p>
                  </div>
                )}
              </div>
              <div className="checkIn__paymentConfirmationTotal">
                <div className="checkIn__totalsBreakdown">
                  {/* Total Cash to Receive - Uses the cleaned up math from above */}
                  <div className="checkIn__totalRow cash-total">
                    <p>ยอดเงินสดที่ต้องรับ:</p>
                    <p className="checkIn__paymentConfirmationTotalText">
                      {formatCurrency(cashTotal)}
                    </p>
                  </div>

                  {/* Total Other Methods */}
                  {hasOutstandingRoomCharge &&
                    unpaidPaymentPaymentMethod !== "Cash" && (
                      <div className="checkIn__totalRow other-total">
                        <p>ยอด {unpaidPaymentPaymentMethod}:</p>
                        <p className="checkIn__paymentConfirmationTotalText">
                          {formatCurrency(
                            adjustedRoomChargeAmount + cardSurcharge,
                          )}
                        </p>
                      </div>
                    )}
                </div>

                {hasPaymentToConfirm && (
                  <label className="checkbox">
                    {adminHistoricalCheckIn
                      ? "ยืนยันยอดที่รับไว้แล้ว"
                      : "ยืนยันรับเงิน"}
                    <input
                      type="checkbox"
                      checked={confirmedPayment}
                      aria-invalid={Boolean(fieldErrors?.payment)}
                      aria-describedby={fieldErrors?.payment ? `${fieldId}-payment-error` : undefined}
                      onChange={(e) => setConfirmedPayment(e.target.checked)}
                    />
                    <span className="box"></span>
                  </label>
                )}
              </div>{" "}
            </div>
            {fieldErrors?.payment && <p id={`${fieldId}-payment-error`} className="formField__error">{fieldErrors.payment}</p>}
          </div>
        </div>
      </div>

      <div className="checkIn__actions">
        {hasOutstandingRoomCharge && unpaidPaymentPaymentMethod === "Cash" && (
          <ActionButton
            text="รับเงินสดไม่ตรงค่าห้อง"
            onClick={() => {
              setRoundingAdjustment(!roundingAdjustment);
              setConfirmedPayment(false);
            }}
            icon={roundingAdjustment ? "bx-check" : "bx-currency-notes"}
            highlight={roundingAdjustment}
          />
        )}
        <ActionButton
          text={adminHistoricalCheckIn ? "Onboard Existing Stay" : "Check In"}
          disabled={submitting}
          onClick={() =>
            toast.promise(checkInHandler(), {
              loading: `กำลังเช็คอิน ${booking.name}`,
              success: `เช็คอิน ${booking.name} สำเร็จ`,
              error: (err) =>
                getApiErrorMessage(
                  err,
                  "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
                ),
            })
          }
          className="checkIn__confirmAction"
          icon="bx-check-circle"
          highlight={true}
        />
      </div>
    </div>
  );
};

export default CheckIn;
