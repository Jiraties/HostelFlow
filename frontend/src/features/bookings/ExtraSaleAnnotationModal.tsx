import { useState } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import Select from "react-select";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import { API_URL } from "../../config/api";
import { getApiErrorMessage } from "../../helpers/apiErrorMessage";
import { formatDisplayDate, formatDisplayDateTime } from "../../helpers/displayDate";
import { formatCompactRoomNames } from "../../helpers/roomStayHelpers";
import {
  calendarAnnotationLabel,
  calendarAnnotationOptions,
  calendarAnnotationTitle,
  type CalendarAnnotationKind,
} from "../../helpers/calendarAnnotations";
import { useAuth } from "../../context/AuthContext";
import { customStyles, type OptionType } from "../../helpers/selectStyling";
import "./AddTransaction.css";
import "./CheckIn.css";
import "./ExtraSaleAnnotationModal.css";

export type CalendarExtraSaleAnnotation = {
  annotationId: string;
  roomId: string;
  roomIds: string[];
  from: string | Date;
  to: string | Date;
  kind?: CalendarAnnotationKind;
  customReason?: string;
  note: string;
  createdBy: string;
  createdAt: string | Date;
  updatedBy?: string;
  updatedAt?: string | Date;
};

export type NewExtraSaleAnnotation = {
  roomIds: string[];
  from: string;
  to: string;
};

const ExtraSaleAnnotationModal = ({
  selection,
  annotation,
  onClose,
  onChanged,
}: {
  selection?: NewExtraSaleAnnotation | null;
  annotation?: CalendarExtraSaleAnnotation | null;
  onClose: () => void;
  onChanged: () => void;
}) => {
  const { user } = useAuth();
  const dateFormat = user?.settings.dateFormat || "dd/MM/yyyy";
  const [kind, setKind] = useState<CalendarAnnotationKind>(annotation?.kind || "EXTRA_SALE");
  const [customReason, setCustomReason] = useState(annotation?.customReason || "");
  const [note, setNote] = useState(annotation?.note || "");
  const [submitting, setSubmitting] = useState(false);
  const isCreate = !annotation;
  const roomIds = annotation?.roomIds || selection?.roomIds || [];
  const roomNames = formatCompactRoomNames(roomIds);
  const from = annotation?.from || selection?.from || "";
  const to = annotation?.to || selection?.to || "";
  const label = calendarAnnotationLabel(annotation?.kind, annotation?.customReason);
  const title = calendarAnnotationTitle(
    isCreate ? kind : annotation?.kind,
    isCreate ? customReason : annotation?.customReason,
  );
  const cannotSubmit =
    submitting ||
    (isCreate &&
      (!roomIds.length ||
        !from ||
        !to ||
        new Date(from) >= new Date(to) ||
        (kind === "OTHER" && !customReason.trim()))) ||
    (!isCreate && note.trim() === annotation?.note);

  const submit = async (action: "create" | "note" | "remove") => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (action === "create") {
        await axios.post(
          `${API_URL}/bookings/extra-sale-annotations`,
          { roomIds, from, to, kind, customReason: customReason.trim(), note: note.trim() },
          { withCredentials: true },
        );
      } else if (action === "note") {
        await axios.patch(
          `${API_URL}/bookings/extra-sale-annotations/${annotation?.annotationId}/note`,
          { note: note.trim() },
          { withCredentials: true },
        );
      } else {
        await axios.patch(
          `${API_URL}/bookings/extra-sale-annotations/${annotation?.annotationId}/remove`,
          {},
          { withCredentials: true },
        );
      }
      onChanged();
      onClose();
      toast.success(action === "remove" ? "ลบหมายเหตุแล้ว" : "บันทึกหมายเหตุแล้ว");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "ไม่สามารถบันทึกหมายเหตุได้"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="checkIn__wrapper extraSaleModal">
      <ModalCloseButton onClick={onClose} />
      <div className="checkIn__header">
        <h1 className="checkIn__title">{title}</h1>
      </div>

      <div className="checkIn__grid">
        <div className="checkIn__left">
          <div>
            <p className="checkIn__label">ประเภทหมายเหตุ</p>
            {isCreate ? (
              <Select<OptionType>
                styles={customStyles<OptionType>()}
                options={calendarAnnotationOptions}
                value={calendarAnnotationOptions.find((option) => option.value === kind)}
                formatOptionLabel={(option) => (
                  <span className="extraSaleModal__option">
                    <span className="extraSaleModal__optionDot" aria-hidden="true" />
                    {option.label}
                  </span>
                )}
                onChange={(option) =>
                  setKind((option?.value || "EXTRA_SALE") as CalendarAnnotationKind)
                }
                isDisabled={submitting}
              />
            ) : (
              <p className="extraSaleModal__readOnlyValue">
                <span className="extraSaleModal__optionDot" aria-hidden="true" />
                {label}
              </p>
            )}
          </div>

          {isCreate && kind === "OTHER" && (
            <div>
              <p className="checkIn__label">หัวข้อหมายเหตุ</p>
              <input
                className="boxInput"
                type="text"
                maxLength={80}
                value={customReason}
                onChange={(event) => setCustomReason(event.target.value)}
                disabled={submitting}
                placeholder="ระบุเรื่องที่ต้องการแจ้ง"
              />
            </div>
          )}

          <div>
            <p className="checkIn__label">
              หมายเหตุ
              <span className="addTransaction__optionalLabel">(ไม่บังคับ)</span>
            </p>
            <textarea
              className="boxInput extraSaleModal__note"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={submitting}
              placeholder="รายละเอียดเพิ่มเติม"
            />
          </div>
        </div>

        <div className="checkIn__right">
          <div>
            <p className="checkIn__label">ช่วงที่เลือก</p>
            <div className="extraSaleModal__selectionCard">
              <div className="extraSaleModal__summaryRow">
                <span>ห้อง / เตียง</span>
                <strong>{roomNames}</strong>
              </div>
              <div className="extraSaleModal__summaryRow">
                <span>เริ่ม</span>
                <strong>{formatDisplayDate(from, dateFormat)}</strong>
              </div>
              <div className="extraSaleModal__summaryRow">
                <span>สิ้นสุด</span>
                <strong>{formatDisplayDate(to, dateFormat)}</strong>
              </div>
            </div>
          </div>
          {!isCreate && annotation && (
            <div className="extraSaleModal__audit">
              <p>โดย {annotation.createdBy} · {formatDisplayDateTime(annotation.createdAt, dateFormat)}</p>
              {annotation.updatedAt && (
                <p>แก้หมายเหตุโดย {annotation.updatedBy} · {formatDisplayDateTime(annotation.updatedAt, dateFormat)}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="checkIn__actions extraSaleModal__actions">
        {!isCreate && (
          <ActionButton
            text="ลบเครื่องหมาย"
            icon="bx-trash"
            disabled={submitting}
            onClick={() => submit("remove")}
          />
        )}
        <ActionButton
          text={isCreate ? "ทำเครื่องหมาย" : "บันทึกหมายเหตุ"}
          icon="bx-check-circle"
          className="checkIn__confirmAction"
          highlight
          disabled={cannotSubmit}
          onClick={() => submit(isCreate ? "create" : "note")}
        />
      </div>
    </div>
  );
};

export default ExtraSaleAnnotationModal;
