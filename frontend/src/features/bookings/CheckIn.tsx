import { useState, useEffect } from "react";
import type { booking } from "../../types/bookingTypes";
import "./CheckIn.css";
import Select from "react-select";
import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";
import { customStyles } from "../../helpers/selectStyling";
import ActionButton from "../../components/ActionButton";
import { roomChargeTransaction } from "../../helpers/bookingHelpers";
import type { OptionType } from "../../helpers/selectStyling";
import axios from "axios";
import toast from "react-hot-toast";
import { API_URL } from "../../config/api";

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

const CheckIn = ({
  booking,
  handleCheckInSuccess,
}: {
  booking: booking;
  handleCheckInSuccess: (booking: booking) => void;
}) => {
  const roomCharge = roomChargeTransaction(booking);

  const [deposit, setDeposit] = useState<number | "">(200);
  const [unpaidPaymentPaymentMethod, setUnpaidPaymentPaymentMethod] =
    useState<string>("Cash");
  const [confirmedPayment, setConfirmedPayment] = useState<boolean>(false);
  const [nationality, setNationality] = useState<string>("");
  const [passportName, setPassportName] = useState<string>("");
  const [passportNo, setPassportNo] = useState<string>("");
  const [roundingAdjustment, setRoundingAdjustment] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receivedCash, setReceivedCash] = useState<string>(
    String(roomCharge.amount),
  );

  useEffect(() => {
    setReceivedCash(String(roomCharge.amount));
  }, [roomCharge.amount]);

  const formatCurrency = (num: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
      currency: "THB",
    }).format(num);

  // --- CLEAN MATH FOR THE UI TOTALS ---
  let cashTotal = Number(deposit) || 0;
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

  const checkInHandler = async () => {
    if (
      !nationality ||
      !passportName ||
      !passportNo ||
      deposit === "" ||
      Number.isNaN(deposit)
    ) {
      throw new Error("กรุณากรอกข้อมูลให้ครบทุกช่อง");
    }

    if (!confirmedPayment) {
      throw new Error("กรุณายืนยันการรับเงินสดจากลูกค้า");
    }

    try {
      setSubmitting(true);

      // Dynamically build payload to preserve the selected payment method!
      const payload: any = {
        deposit: Number(deposit),
        passportData: {
          passportNo,
          passportName,
          nationality,
        },
      };

      if (roomCharge.paymentMethod === "Unpaid") {
        payload.unpaidPayment = {
          paymentMethod: unpaidPaymentPaymentMethod,
          roundingAdjustment: roundingAdjustment
            ? Number(receivedCash) - roomCharge.amount
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
    } catch (error) {
      throw error;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="checkIn__wrapper">
      <div>
        <div className="checkIn__header">
          <h1 className="checkIn__title">เช็คอิน {booking.name}</h1>
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
        </div>
      </div>
      <div className="checkIn__grid">
        <div className="checkIn__left">
          <div>
            {" "}
            <p className="checkIn__label">
              เลข Passport <i className="bx bx-check-shield" />
            </p>
            <input
              type="text"
              value={passportNo}
              onChange={(e) => setPassportNo(e.target.value)}
              className="boxInput"
              placeholder="เช่น A12345678"
            />
          </div>
          <div>
            <p className="checkIn__label">
              ชื่อ-นามสกุล Passport <i className="bx bx-check-shield" />
            </p>
            <input
              type="text"
              value={passportName}
              onChange={(e) => setPassportName(e.target.value.toUpperCase())}
              className="boxInput"
              placeholder="เช่น ROBERT BROWN"
            />
          </div>
          <div>
            <p className="checkIn__label">ชาติ</p>
            <Select<OptionType>
              styles={customStyles<OptionType>()}
              options={nationalityOptions}
              value={nationalityOptions.find(
                (option) => option.value === nationality,
              )}
              onChange={(option) => setNationality(option?.value || "")}
            />{" "}
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
              placeholder="200"
              onChange={(e) => {
                setDeposit(e.target.value === "" ? "" : Number(e.target.value));
                setConfirmedPayment(false);
              }}
            />
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
                  if (option?.value !== "Cash")
                    setReceivedCash(String(roomCharge.amount));

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
                    <span className="checkIn__paymentTag cash">Cash</span>
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
                          {formatCurrency(roomCharge.amount)}
                        </p>
                      </div>
                    )}
                </div>

                <label className="checkbox">
                  ยืนยันการทำรายการ
                  <input
                    type="checkbox"
                    checked={confirmedPayment}
                    onChange={(e) => setConfirmedPayment(e.target.checked)}
                  />
                  <span className="box"></span>
                </label>
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
              error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
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
