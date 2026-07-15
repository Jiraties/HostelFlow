import { useState, useEffect } from "react";
import type { booking } from "../../types/bookingTypes";
import "./CheckIn.css";
import Select from "react-select";
import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";
import { customStyles } from "../../helpers/selectStyling";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import CashShiftNudge from "../../components/CashShiftNudge";
import { roomChargeTransaction } from "../../helpers/bookingHelpers";
import type { OptionType } from "../../helpers/selectStyling";
import axios from "axios";
import toast from "react-hot-toast";
import { API_URL } from "../../config/api";
import "./CheckOut.css";

countries.registerLocale(en);

const getFlagEmoji = (code: string) =>
  code
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));

const nationalityOptions = Object.entries(countries.getNames("en")).map(
  ([code, name]) => ({
    value: code,
    label: `${name} ${getFlagEmoji(code)}`,
  }),
);

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
  handleCheckInSuccess,
  onClose,
  onDirtyChange,
}: {
  booking: booking;
  isLateCheckIn?: boolean;
  nightsLate?: number;
  handleCheckInSuccess: (booking: booking) => void;
  onClose?: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
}) => {
  const roomCharge = roomChargeTransaction(booking);
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
  const [receivedCash, setReceivedCash] = useState<string>(
    String(roomCharge.amount),
  );
  const isThaiGuest = nationality === "TH";
  const activeNamePrefixOptions = isThaiGuest
    ? thaiNamePrefixOptions
    : foreignNamePrefixOptions;
  const thaiNameParts = splitGuestName(passportName);

  useEffect(() => {
    setReceivedCash(String(roomCharge.amount));
  }, [roomCharge.amount]);

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
        receivedCash !== String(roomCharge.amount),
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
    receivedCash,
    roomCharge.amount,
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

  const cardSurcharge =
    roomCharge.paymentMethod === "Unpaid" &&
    unpaidPaymentPaymentMethod === "Card"
      ? Number((roomCharge.amount * 0.03).toFixed(2))
      : 0;

  // --- CLEAN MATH FOR THE UI TOTALS ---
  let cashTotal = hasExistingDeposit ? 0 : Number(deposit) || 0;
  if (roomCharge.paymentMethod === "Unpaid") {
    if (unpaidPaymentPaymentMethod === "Cash") {
      cashTotal += roundingAdjustment
        ? Number(receivedCash)
        : roomCharge.amount;
    } else if (roundingAdjustment) {
      // If paying by card/transfer, but they handed over extra cash for convenience
      cashTotal += Number(receivedCash) - roomCharge.amount;
    }
  }
  const hasCashMovement = cashTotal > 0;
  const hasPaymentToConfirm =
    !hasExistingDeposit || roomCharge.paymentMethod === "Unpaid";

  const checkInHandler = async () => {
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
      throw new Error("กรุณายืนยันการรับเงินสดจากลูกค้า");
    }

    const parsedReceivedCash = Number(receivedCash);

    if (
      roomCharge.paymentMethod === "Unpaid" &&
      roundingAdjustment &&
      (!Number.isFinite(parsedReceivedCash) ||
        parsedReceivedCash < roomCharge.amount)
    ) {
      throw new Error("ยอดเงินสดค่าห้องต้องไม่ต่ำกว่าค่าห้อง");
    }

    setSubmitting(true);

    try {
      // Dynamically build payload to preserve the selected payment method!
      const payload: CheckInPayload = {
        expectedRevision: booking.revision,
        deposit: Number(deposit),
        passportData: {
          namePrefix,
          passportNo,
          passportName,
          nationality,
          nextDestinationCountry,
        },
      };

      if (roomCharge.paymentMethod === "Unpaid") {
        payload.unpaidPayment = {
          paymentMethod: unpaidPaymentPaymentMethod,
          roundingAdjustment: roundingAdjustment
            ? parsedReceivedCash - roomCharge.amount
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
          {(isLateCheckIn || roomCharge.paymentMethod === "Unpaid" || hasCashMovement) && (
            <div className="bookingNoticeStack">
              {isLateCheckIn && (
                <div className="checkIn__reminder checkOut__earlyReminder">
                  <i className="bx bx-message-bubble-exclamation" />
                  <p>
                    ลูกค้าดังกล่าวเช็คอินล่าช้า{" "}
                    <strong>{nightsLate || 0} คืน</strong>
                  </p>
                </div>
              )}
              {roomCharge.paymentMethod === "Unpaid" && (
                <div className="checkIn__reminder">
                  <i className="bx bx-message-bubble-exclamation" />
                  <p>
                    ลูกค้าดังกล่าว
                    <strong>
                      ยังไม่ชำระเงินค่าห้อง
                      {" " + formatCurrency(roomCharge.amount)}
                    </strong>
                  </p>
                </div>
              )}
              {hasCashMovement && <CashShiftNudge />}
            </div>
          )}
        </div>
      </div>
      <div className="checkIn__grid">
        <div className="checkIn__left">
          <div>
            {" "}
            <p className="checkIn__label">
              {isThaiGuest ? "เลขประจำตัวประชาชน" : "เลข Passport"}{" "}
              <i className="bx bx-check-shield" />
            </p>
            <input
              type="text"
              value={passportNo}
              onChange={(e) =>
                setPassportNo(
                  isThaiGuest
                    ? e.target.value.replace(/\D/g, "").slice(0, 13)
                    : e.target.value,
                )
              }
              inputMode={isThaiGuest ? "numeric" : undefined}
              maxLength={isThaiGuest ? 13 : undefined}
              className="boxInput"
              placeholder={isThaiGuest ? "เลข 13 หลัก" : "เช่น A12345678"}
            />
          </div>
          <div className="checkIn__nameRow">
            <div className="checkIn__prefixField">
              <p className="checkIn__label">คำนำหน้าชื่อ</p>
              <Select<OptionType>
                styles={customStyles<OptionType>()}
                options={activeNamePrefixOptions}
                value={activeNamePrefixOptions.find(
                  (option) => option.value === namePrefix,
                )}
                onChange={(option) => setNamePrefix(option?.value || "")}
                placeholder="เลือก"
              />
            </div>
            <div className="checkIn__passportNameField">
              <p className="checkIn__label">
                {isThaiGuest ? "ชื่อ-นามสกุลภาษาไทย" : "ชื่อ-นามสกุล Passport"}{" "}
                <i className="bx bx-check-shield" />
              </p>
              <input
                type="text"
                value={passportName}
                onChange={(e) =>
                  setPassportName(
                    isThaiGuest ? e.target.value : e.target.value.toUpperCase(),
                  )
                }
                className="boxInput"
                placeholder={
                  isThaiGuest ? "เช่น สมชาย กลาง ใจดี" : "เช่น ROBERT BROWN"
                }
              />
            </div>
          </div>
          <div>
            <p className="checkIn__label">ชาติ</p>
            <Select<OptionType>
              styles={customStyles<OptionType>()}
              options={nationalityOptions}
              value={nationalityOptions.find(
                (option) => option.value === nationality,
              )}
              onChange={(option) => {
                const nextNationality = option?.value || "";
                const nextIsThai = nextNationality === "TH";

                if (nextIsThai !== isThaiGuest) {
                  setNamePrefix("");
                  setPassportNo("");
                }
                setNationality(nextNationality);
              }}
            />{" "}
          </div>
          <div>
            <p className="checkIn__label">ประเทศปลายทางถัดไป</p>
            <Select<OptionType>
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
          </div>
        </div>
        <div className="checkIn__right">
          <div>
            <p className="checkIn__label">มัดจำ (บาท)</p>
            <input
              className="boxInput"
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
            {hasExistingDeposit && (
              <p className="checkIn__label">
                รับมัดจำรายการนี้ไว้แล้ว ระบบจะนำมาใช้กับการ check-in
              </p>
            )}
          </div>

          {roomCharge.paymentMethod === "Unpaid" && (
            <div>
              <p className="checkIn__label">ช่องทางการจ่ายค่าห้อง</p>
              <Select<OptionType>
                styles={customStyles<OptionType>()}
                options={paymentMethodOptions}
                value={paymentMethodOptions.find(
                  (option) => option.value === unpaidPaymentPaymentMethod,
                )}
                onChange={(option) => {
                  if (option?.value !== "Cash") {
                    setReceivedCash(String(roomCharge.amount));
                    setRoundingAdjustment(false);
                  }

                  setConfirmedPayment(false);
                  setUnpaidPaymentPaymentMethod(option?.value || "");
                }}
              />
            </div>
          )}

          {/* Restored: Allows extra cash input regardless of payment method selected */}
          {roundingAdjustment && unpaidPaymentPaymentMethod === "Cash" && (
            <div>
              <p className="checkIn__label">รับเงินสดค่าห้องมา (บาท)</p>
              <input
                className="boxInput"
                type="number"
                value={receivedCash}
                placeholder="200"
                onChange={(e) => {
                  setReceivedCash(e.target.value);
                }}
              />
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
                {roomCharge.paymentMethod === "Unpaid" && (
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
                      {formatCurrency(roomCharge.amount)}
                      {roundingAdjustment && (
                        <span className="checkIn__extraAmountReceived">
                          {` + เกิน ${formatCurrency(Number(receivedCash) - roomCharge.amount)}`}
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
                  {roomCharge.paymentMethod === "Unpaid" &&
                    unpaidPaymentPaymentMethod !== "Cash" && (
                      <div className="checkIn__totalRow other-total">
                        <p>ยอด {unpaidPaymentPaymentMethod}:</p>
                        <p className="checkIn__paymentConfirmationTotalText">
                          {formatCurrency(roomCharge.amount + cardSurcharge)}
                        </p>
                      </div>
                    )}
                </div>

                {hasPaymentToConfirm && (
                  <label className="checkbox">
                    ยืนยันรับเงิน
                    <input
                      type="checkbox"
                      checked={confirmedPayment}
                      onChange={(e) => setConfirmedPayment(e.target.checked)}
                    />
                    <span className="box"></span>
                  </label>
                )}
              </div>{" "}
            </div>
          </div>
        </div>
      </div>

      <div className="checkIn__actions">
        {/* Restored: Allows the button to be clicked for ANY payment method */}
        {roomCharge.paymentMethod === "Unpaid" &&
          unpaidPaymentPaymentMethod === "Cash" && (
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
          text="Check In"
          disabled={submitting}
          onClick={() =>
            toast.promise(checkInHandler(), {
              loading: `กำลังเช็คอิน ${booking.name}`,
              success: `เช็คอิน ${booking.name} สำเร็จ`,
              error: (err) =>
                err.response?.data?.message ||
                err.response?.data?.error ||
                err.message ||
                "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
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
