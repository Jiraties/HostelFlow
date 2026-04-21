import { useState } from "react";
import type { booking } from "../../types/bookingTypes";
import "./CheckIn.css";
import Select from "react-select";
import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";
import { customStyles } from "./AddBooking";
import ActionButton from "../../components/ActionButton";
import { roomChargeTransaction } from "../../helpers/bookingHelpers";
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

const CheckIn = ({
  booking,
  handleCheckInSuccess,
}: {
  booking: booking;
  handleCheckInSuccess: (booking: booking) => void;
}) => {
  const [deposit, setDeposit] = useState<number>(200);
  const [confirmedPayment, setConfirmedPayment] = useState<boolean>(false);
  const [nationality, setNationality] = useState<string>("");
  const [passportName, setPassportName] = useState<string>("");
  const [passportNo, setPassportNo] = useState<string>("");
  const [roundingAdjustment, setRoundingAdjustment] = useState(false);
  const [receivedCash, setReceivedCash] = useState<string>(
    String(roomChargeTransaction(booking).amount),
  );

  const formatCurrency = (num: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
      currency: "THB",
    }).format(num);

  const checkInHandler = async () => {
    if (!nationality || !passportName || !passportNo || !deposit) {
      toast.error("กรุณากรอกข้อมูลให้ครบทุกช่อง");
      return;
    }

    if (!confirmedPayment) {
      toast.error("กรุณายืนยันการรับเงินสดจากลูกค้า");
      return;
    }

    try {
      const response = await axios.put(
        `${API_URL}/bookings/checkIn/` + booking?.bookingId,
        roundingAdjustment
          ? {
              deposit,
              unpaidPayment: {
                paymentMethod: "Cash",
                roundingAdjustment:
                  Number(receivedCash) - roomChargeTransaction(booking).amount,
              },
              passportData: {
                passportNo: nationality,
                passportName: "asdasd",
                nationality: "asdasd",
              },
            }
          : {
              deposit,
              passportData: {
                passportNo: nationality,
                passportName: "asdasd",
                nationality: "asdasd",
              },
            },
        { withCredentials: true },
      );

      if (response.status === 200) {
        toast.success(`Check-In สำหรับ ${response.data.name} สำเร็จ`, {
          duration: 5000,
        });
        handleCheckInSuccess(response.data);
        console.log(response);
      }
    } catch (err: any) {
      toast.error(err);
    }
  };

  return (
    <div className="checkIn__wrapper">
      <div>
        <div className="checkIn__header">
          <h1 className="checkIn__title">เช็คอิน {booking.name}</h1>
          {roomChargeTransaction(booking).paymentMethod === "Unpaid" && (
            <div className="checkIn__reminder">
              <i className="bx bx-message-bubble-exclamation" />
              <p>
                ลูกค้าดังกล่าว
                <strong>
                  ยังไม่ชำระเงินค่าห้อง
                  {" " + formatCurrency(roomChargeTransaction(booking).amount)}
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
              onChange={(e) => setPassportName(e.target.value)}
              className="boxInput"
              style={{ textTransform: "uppercase" }}
              placeholder="เช่น Robert Brown"
            />
          </div>
          <div>
            <p className="checkIn__label">ชาติ</p>
            <Select
              options={nationalityOptions}
              styles={customStyles}
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
              // value={formData.roomId}
              placeholder="200"
              onChange={(e) => {
                setDeposit(Number(e.target.value));
                setConfirmedPayment(false);
              }}
            />
          </div>
          {roundingAdjustment && (
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
            <p style={{ marginBottom: ".5rem" }}>ยืนยันการรับเงินสด</p>
            <div className="checkIn__paymentConfirmation">
              {/* <h3>ยืนยันการรับเงินสด</h3> */}
              <div className="checkIn__paymentConfirmationList">
                <p>ค่ามัดจำ: {formatCurrency(deposit)}</p>
                {roomChargeTransaction(booking).paymentMethod === "Unpaid" && (
                  <p>
                    ค่าห้อง:{" "}
                    {formatCurrency(roomChargeTransaction(booking).amount)}
                    <span className="checkIn__extraAmountReceived">
                      {roundingAdjustment &&
                        ` + เกิน ${formatCurrency(Number(receivedCash) - roomChargeTransaction(booking).amount)}`}
                    </span>
                  </p>
                )}
              </div>
              <div className="checkIn__paymentConfirmationTotal">
                <div>
                  <p>รับเงินสดทั้งหมด:</p>
                  <p className="checkIn__paymentConfirmationTotalText">
                    {roomChargeTransaction(booking).paymentMethod === "Unpaid"
                      ? formatCurrency(
                          deposit +
                            (roundingAdjustment
                              ? Number(receivedCash)
                              : roomChargeTransaction(booking).amount),
                        )
                      : formatCurrency(deposit)}
                  </p>
                </div>

                <label className="checkbox">
                  ยืนยันการรับเงินสด
                  <input
                    type="checkbox"
                    checked={confirmedPayment}
                    onChange={(e) => setConfirmedPayment(e.target.checked)}
                  />
                  <span className="box"></span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="checkIn__actions">
        {roomChargeTransaction(booking).paymentMethod === "Unpaid" && (
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
          onClick={checkInHandler}
          className="checkIn__confirmAction"
          icon="bx-check-circle"
          highlight={true}
        />
      </div>
    </div>
  );
};

export default CheckIn;
