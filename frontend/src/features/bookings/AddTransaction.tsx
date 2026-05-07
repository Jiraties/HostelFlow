import { useState } from "react";
import Select, { type SingleValue } from "react-select";
import toast from "react-hot-toast";
import axios from "axios";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import { API_URL } from "../../config/api";
import { formatBookingDates } from "../../helpers/bookingHelpers";
import { paymentMethodOptions } from "../../helpers/options";
import { customStyles, type OptionType } from "../../helpers/selectStyling";
import type { booking } from "../../types/bookingTypes";
import "./AddTransaction.css";

type Transaction = booking["transactions"][number];
type TransactionType = Transaction["type"];
type PaymentMethod = Transaction["paymentMethod"];

type AddTransactionFormData = {
  type: TransactionType | "";
  paymentMethod: PaymentMethod | "";
  amount: string;
};

const transactionTypeOptions: OptionType[] = [
  { value: "towel", label: "ผ้าเช็ดตัว", color: "#38bdf8" },
  { value: "motorbike", label: "มอเตอร์ไซค์", color: "#fb923c" },
  { value: "extraBed", label: "เตียงเสริม", color: "#ec4899" },
  { value: "joinTour", label: "Join Tour", color: "#22c55e" },
  { value: "slowBoat", label: "Slow Boat", color: "#2dd4bf" },
  { value: "adjustment", label: "ปรับราคา", color: "#a78bfa" },
  { value: "deposit", label: "รับมัดจำ", color: "#facc15" },
  { value: "depositRefund", label: "คืนมัดจำ", color: "#f87171" },
];

const addTransactionPaymentMethodOptions = paymentMethodOptions.filter(
  (option) => option.value !== "OTA" && option.value !== "Unpaid",
);

const AddTransaction = ({
  bookingId,
  onClose,
  onUpdated,
}: {
  bookingId: string;
  guestName: string;
  onClose: () => void;
  onUpdated?: (booking: booking) => void;
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<AddTransactionFormData>({
    type: "",
    paymentMethod: "",
    amount: "",
  });

  const formDataChangeHandler = (
    field: keyof AddTransactionFormData,
    value: string,
  ) => {
    if (submitting) return;
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const formatPaymentMethodLabel = ({ label }: { label: string }) => (
    <div style={label === "Unpaid" ? { color: "red" } : {}}>{label}</div>
  );

  const formatTransactionTypeLabel = ({
    label,
    color,
  }: {
    label: string;
    color?: string;
  }) => (
    <div style={{ display: "flex", alignItems: "center" }}>
      <span
        style={{
          width: "10px",
          height: "10px",
          borderRadius: "50%",
          backgroundColor: color || "#ddd",
          display: "inline-block",
          marginRight: "8px",
        }}
      />
      {label}
    </div>
  );

  const amount = Number(formData.amount);
  const validAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const shouldShowCardSurcharge =
    formData.paymentMethod === "Card" && formData.type !== "depositRefund";
  const cardSurcharge = shouldShowCardSurcharge
    ? Number((validAmount * 0.03).toFixed(2))
    : 0;
  const totalGuestPays = validAmount + cardSurcharge;

  const formatCurrency = (value: number) =>
    value.toLocaleString("th-TH", {
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    });

  const submitHandler = async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      if (!formData.type || !formData.paymentMethod || !formData.amount) {
        throw new Error("กรุณากรอกข้อมูลให้ครบทุกช่อง");
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("จำนวนเงินต้องมากกว่า 0");
      }

      const transaction: Transaction = {
        type: formData.type,
        paymentMethod: formData.paymentMethod,
        amount,
      };

      const response = await axios.post(
        `${API_URL}/bookings/addTransaction/${bookingId}`,
        { transaction },
        { withCredentials: true },
      );

      if (response.status !== 200) throw new Error(response.data.message);
      if (response.data.booking) {
        onUpdated?.(formatBookingDates(response.data.booking));
      }

      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="addBooking__wrapper addTransaction__wrapper">
      <ModalCloseButton onClick={onClose} />
      <div className="addTransaction__header">
        <div>
          <h1 className="addBooking__title">เพิ่มรายการใช้จ่าย</h1>
        </div>
      </div>

      <div className="addTransaction__form">
        <div>
          <p className="addBooking__label">ประเภทรายการ</p>
          <Select<OptionType>
            styles={customStyles<OptionType>()}
            classNamePrefix="rs"
            options={transactionTypeOptions}
            placeholder="เลือกประเภทรายการ"
            formatOptionLabel={formatTransactionTypeLabel}
            menuPortalTarget={document.body}
            menuPosition="fixed"
            value={
              transactionTypeOptions.find(
                (option) => option.value === formData.type,
              ) || null
            }
            onChange={(option: SingleValue<OptionType>) =>
              formDataChangeHandler("type", option?.value || "")
            }
          />
        </div>

        <div>
          <p className="addBooking__label">จำนวนเงิน (฿)</p>
          <input
            className="boxInput"
            type="number"
            min="0"
            value={formData.amount}
            placeholder="เช่น 500"
            onChange={(e) => formDataChangeHandler("amount", e.target.value)}
          />
        </div>

        <div>
          <p className="addBooking__label">จ่ายผ่าน</p>
          <Select<OptionType>
            styles={customStyles<OptionType>()}
            classNamePrefix="rs"
            options={addTransactionPaymentMethodOptions}
            placeholder="เลือกช่องทางการชำระเงิน"
            formatOptionLabel={formatPaymentMethodLabel}
            menuPortalTarget={document.body}
            menuPosition="fixed"
            value={
              addTransactionPaymentMethodOptions.find(
                (option) => option.value === formData.paymentMethod,
              ) || null
            }
            onChange={(option: SingleValue<OptionType>) =>
              formDataChangeHandler("paymentMethod", option?.value || "")
            }
          />
        </div>

        {shouldShowCardSurcharge && validAmount > 0 && (
          <div className="addTransaction__cardPreview">
            <div>
              <p>ยอดรายการ</p>
              <strong>{formatCurrency(validAmount)} บาท</strong>
            </div>
            <div>
              <p>ค่าธรรมเนียมบัตร 3%</p>
              <strong>{formatCurrency(cardSurcharge)} บาท</strong>
            </div>
            <div className="addTransaction__cardPreviewTotal">
              <p>ยอดที่ต้องเก็บจากลูกค้า</p>
              <strong>{formatCurrency(totalGuestPays)} บาท</strong>
            </div>
          </div>
        )}
      </div>

      <div className="addTransaction__actions">
        <ActionButton text="ยกเลิก" icon="bx-x" onClick={onClose} />
        <ActionButton
          text="บันทึกรายการ"
          icon="bx-save"
          highlight
          disabled={submitting}
          onClick={() =>
            toast.promise(submitHandler(), {
              loading: "กำลังบันทึกรายการ...",
              success: "เพิ่มรายการใช้จ่ายสำเร็จ",
              error: (err) => {
                if (axios.isAxiosError(err)) {
                  return (
                    err.response?.data?.message ||
                    "เกิดข้อผิดพลาดในการเพิ่มรายการใช้จ่าย"
                  );
                }

                if (err instanceof Error) return err.message;
                return "เกิดข้อผิดพลาดในการเพิ่มรายการใช้จ่าย";
              },
            })
          }
        />
      </div>
    </div>
  );
};

export default AddTransaction;
