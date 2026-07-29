import axios from "axios";
import { useState } from "react";
import Select, { type SingleValue } from "react-select";
import toast from "react-hot-toast";
import ActionButton from "../../components/ActionButton";
import CashShiftNudge from "../../components/CashShiftNudge";
import ModalCloseButton from "../../components/ModalCloseButton";
import { API_URL } from "../../config/api";
import { customStyles, type OptionType } from "../../helpers/selectStyling";
import {
  addTransactionPaymentMethodOptions,
  standaloneTransactionTypeOptions,
  transactionPresets,
} from "../../helpers/transactionFormOptions";
import type { PaymentMethod, TransactionType } from "../../types/bookingTypes";
import "../bookings/AddTransaction.css";
import "./StandaloneSaleModal.css";

type SaleFormData = {
  type: TransactionType | "";
  amount: string;
  paymentMethod: PaymentMethod | "";
  customerName: string;
  reference: string;
  note: string;
};

const emptyForm: SaleFormData = {
  type: "",
  amount: "",
  paymentMethod: "",
  customerName: "",
  reference: "",
  note: "",
};

const formatCurrency = (value: number) =>
  value.toLocaleString("th-TH", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

const formatTransactionTypeLabel = ({
  label,
  color,
}: {
  label: string;
  color?: string;
}) => (
  <div className="standaloneSale__selectOption">
    <span style={{ backgroundColor: color || "#ddd" }} />
    {label}
  </div>
);

const paymentMethodOption = (value: PaymentMethod): OptionType | null =>
  addTransactionPaymentMethodOptions.find((option) => option.value === value) ||
  null;

const StandaloneSaleModal = ({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [showOptionalDetails, setShowOptionalDetails] = useState(false);
  const [formData, setFormData] = useState<SaleFormData>(emptyForm);

  const updateForm = (field: keyof SaleFormData, value: string) => {
    if (submitting) return;
    setFormData((current) => ({ ...current, [field]: value }));
  };

  const selectTransactionType = (value: string) => {
    if (submitting) return;
    const type = value as TransactionType | "";
    const preset = type ? transactionPresets[type] : undefined;
    setFormData((current) => ({
      ...current,
      type,
      ...(preset
        ? {
            amount: String(preset.amount),
            paymentMethod: preset.paymentMethod || "",
          }
        : {}),
    }));
  };

  const createSale = async () => {
    const amount = Number(formData.amount);
    if (
      !formData.type ||
      !formData.paymentMethod ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      throw new Error("กรุณากรอกประเภทรายการ ยอดเงิน และช่องทางชำระเงิน");
    }
    setSubmitting(true);
    try {
      await axios.post(
        `${API_URL}/finance/standalone-sales`,
        {
          customerName: formData.customerName.trim() || undefined,
          reference: formData.reference.trim() || undefined,
          transaction: {
            type: formData.type,
            amount,
            paymentMethod: formData.paymentMethod,
            note: formData.note.trim() || undefined,
          },
        },
        {
          withCredentials: true,
          headers: { "Idempotency-Key": crypto.randomUUID() },
        },
      );
      setFormData(emptyForm);
      setShowOptionalDetails(false);
      onSaved();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const numericAmount = Number(formData.amount);
  const validAmount =
    Number.isFinite(numericAmount) && numericAmount > 0 ? numericAmount : 0;
  const hasCashMovement = formData.paymentMethod === "Cash" && validAmount > 0;
  const cardSurcharge =
    formData.paymentMethod === "Card"
      ? Number((validAmount * 0.03).toFixed(2))
      : 0;
  const totalGuestPays = validAmount + cardSurcharge;

  return (
    <section className="addBooking__wrapper addTransaction__wrapper standaloneSale">
      <ModalCloseButton onClick={onClose} />
      <div className="addTransaction__header standaloneSale__header">
        <div>
          <h1 className="addBooking__title">เพิ่มรายการใช้จ่ายแขกนอก</h1>
          {/* <p className="addTransaction__description">
            บันทึกรายการโดยไม่สร้าง Booking หรือใช้ห้องพัก
          </p> */}
        </div>
        {/* <span className="nonGuestBadge">แขกนอก</span> */}
      </div>

      <div className="addTransaction__form standaloneSale__form">
        {hasCashMovement && <CashShiftNudge />}

        <div>
          <p className="addBooking__label">ประเภทรายการ</p>
          <Select<OptionType>
            styles={customStyles<OptionType>()}
            classNamePrefix="rs"
            options={standaloneTransactionTypeOptions}
            placeholder="เลือกประเภทรายการ"
            formatOptionLabel={formatTransactionTypeLabel}
            menuPortalTarget={document.body}
            menuPosition="fixed"
            value={
              standaloneTransactionTypeOptions.find(
                (option) => option.value === formData.type,
              ) || null
            }
            onChange={(option: SingleValue<OptionType>) =>
              selectTransactionType(option?.value || "")
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
            onChange={(event) => updateForm("amount", event.target.value)}
          />
        </div>

        <div>
          <p className="addBooking__label">จ่ายผ่าน</p>
          <Select<OptionType>
            styles={customStyles<OptionType>()}
            classNamePrefix="rs"
            options={addTransactionPaymentMethodOptions}
            placeholder="เลือกช่องทางการชำระเงิน"
            menuPortalTarget={document.body}
            menuPosition="fixed"
            value={
              formData.paymentMethod
                ? paymentMethodOption(formData.paymentMethod)
                : null
            }
            onChange={(option: SingleValue<OptionType>) =>
              updateForm("paymentMethod", option?.value || "")
            }
          />
        </div>

        <div>
          <p className="addBooking__label">
            หมายเหตุรายการ
            <span className="addTransaction__optionalLabel">(ไม่บังคับ)</span>
          </p>
          <input
            className="boxInput"
            value={formData.note}
            maxLength={500}
            onChange={(event) => updateForm("note", event.target.value)}
            placeholder="รายละเอียดเพิ่มเติมของรายการ"
          />
        </div>

        {showOptionalDetails && (
          <div className="standaloneSale__optionalFields">
            <div>
              <p className="addBooking__label">ชื่อลูกค้า (ไม่บังคับ)</p>
              <input
                className="boxInput"
                value={formData.customerName}
                onChange={(event) =>
                  updateForm("customerName", event.target.value)
                }
                placeholder="เช่น John หรือปล่อยว่างเป็นลูกค้าทั่วไป"
              />
            </div>
            {/* <div>
                  <p className="addBooking__label">เลขอ้างอิง (ไม่บังคับ)</p>
                  <input
                    className="boxInput"
                    value={formData.reference}
                    onChange={(event) =>
                      updateForm("reference", event.target.value)
                    }
                    placeholder="เลขทัวร์ ตั๋ว หรือใบเสร็จ"
                  />
                </div> */}
          </div>
        )}

        {cardSurcharge > 0 && (
          <div className="addTransaction__cardPreview">
            <div className="addTransaction__cardPreviewList">
              <div className="addTransaction__cardPreviewRow">
                <p>ยอดรายการ</p>
                <p>{formatCurrency(validAmount)} บาท</p>
              </div>
              <div className="addTransaction__cardPreviewRow">
                <p>
                  ค่าธรรมเนียมบัตร 3%
                  <span className="addTransaction__paymentTag card">Card</span>
                </p>
                <p>{formatCurrency(cardSurcharge)} บาท</p>
              </div>
            </div>
            <div className="addTransaction__cardPreviewTotal">
              <div className="addTransaction__cardPreviewBreakdown">
                <div className="addTransaction__cardPreviewTotalRow">
                  <p>ยอดที่ต้องเก็บจากลูกค้า</p>
                  <p className="addTransaction__cardPreviewTotalText">
                    {formatCurrency(totalGuestPays)} บาท
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="addTransaction__actions standaloneSale__actions">
        <ActionButton
          text={showOptionalDetails ? "ซ่อนข้อมูลแขกนอก" : "เพิ่มข้อมูลแขกนอก"}
          icon={showOptionalDetails ? "bx-chevron-up" : "bx-user-plus"}
          className={
            showOptionalDetails ? "standaloneSale__detailsAction--active" : ""
          }
          onClick={() => setShowOptionalDetails((current) => !current)}
        />
        <ActionButton
          text="บันทึกรายการ"
          icon="bx-save"
          highlight
          disabled={submitting}
          onClick={() =>
            toast.promise(createSale(), {
              loading: "กำลังบันทึกรายการ...",
              success: "บันทึกรายการแขกนอกแล้ว",
              error: (error) =>
                axios.isAxiosError(error)
                  ? error.response?.data?.message || "บันทึกไม่สำเร็จ"
                  : error.message,
            })
          }
        />
      </div>
    </section>
  );
};

export default StandaloneSaleModal;
