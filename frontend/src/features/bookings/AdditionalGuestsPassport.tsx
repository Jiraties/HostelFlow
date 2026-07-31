import axios from "axios";
import countries from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";
import { Modal } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import Select from "react-select";
import ActionButton from "../../components/ActionButton";
import ModalCloseButton from "../../components/ModalCloseButton";
import { API_URL } from "../../config/api";
import { customStyles } from "../../helpers/selectStyling";
import type { OptionType } from "../../helpers/selectStyling";
import "./AdditionalGuestsPassport.css";

countries.registerLocale(en);

type GuestSummary = {
  guestId: string;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
};

type PassportData = {
  namePrefix: string;
  nationality: string;
  passportNo: string;
  passportName: string;
};

type GuestListResponse = {
  revision: number;
  additionalGuests: GuestSummary[];
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

const emptyPassport: PassportData = {
  namePrefix: "",
  nationality: "",
  passportNo: "",
  passportName: "",
};

const errorMessage = (err: unknown, fallback: string) =>
  axios.isAxiosError<{ error?: string; message?: string }>(err)
    ? err.response?.data.message || err.response?.data.error || fallback
    : fallback;

const AdditionalGuestsPassport = ({
  bookingId,
  revision,
  primaryNationality,
  onRevisionChange,
}: {
  bookingId: string;
  revision: number;
  primaryNationality?: string;
  onRevisionChange: (revision: number) => void;
}) => {
  const [guests, setGuests] = useState<GuestSummary[]>([]);
  const revisionRef = useRef(revision);
  const [loading, setLoading] = useState(true);
  const [revealedGuestId, setRevealedGuestId] = useState<string | null>(null);
  const [revealedPassport, setRevealedPassport] = useState<PassportData | null>(
    null,
  );
  const [revealingGuestId, setRevealingGuestId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingGuestId, setEditingGuestId] = useState<string | null>(null);
  const [formData, setFormData] = useState<PassportData>(emptyPassport);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);

  useEffect(() => {
    let ignore = false;

    const fetchGuests = async () => {
      try {
        setLoading(true);
        const response = await axios.get<GuestListResponse>(
          `${API_URL}/bookings/${bookingId}/additional-guests`,
          { withCredentials: true },
        );
        if (ignore) return;

        setGuests(response.data.additionalGuests);
        revisionRef.current = response.data.revision;
      } catch (err) {
        if (!ignore) {
          toast.error(
            errorMessage(err, "ไม่สามารถโหลด Passport ผู้เข้าพักได้"),
          );
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    void fetchGuests();
    return () => {
      ignore = true;
    };
  }, [bookingId]);

  useEffect(() => {
    if (!revealedPassport) return;
    const timeout = window.setTimeout(() => {
      setRevealedGuestId(null);
      setRevealedPassport(null);
    }, 60_000);
    return () => window.clearTimeout(timeout);
  }, [revealedPassport]);

  const applyRevision = (nextRevision: number) => {
    revisionRef.current = nextRevision;
    onRevisionChange(nextRevision);
  };

  const hidePassport = () => {
    setRevealedGuestId(null);
    setRevealedPassport(null);
  };

  const revealPassport = async (guestId: string) => {
    if (revealingGuestId) return;
    try {
      setRevealingGuestId(guestId);
      const response = await axios.get<{
        passportData: PassportData;
      }>(
        `${API_URL}/bookings/${bookingId}/additional-guests/${guestId}/passport`,
        { withCredentials: true },
      );
      setRevealedGuestId(guestId);
      setRevealedPassport(response.data.passportData);
    } catch (err) {
      toast.error(errorMessage(err, "ไม่สามารถเปิดดู Passport ได้"));
    } finally {
      setRevealingGuestId(null);
    }
  };

  const openAddForm = () => {
    setEditingGuestId(null);
    setFormData({
      ...emptyPassport,
      nationality: primaryNationality || "",
    });
    setReason("");
    setFormOpen(true);
  };

  const openEditForm = () => {
    if (!revealedGuestId || !revealedPassport) return;
    setEditingGuestId(revealedGuestId);
    setFormData(revealedPassport);
    setReason("");
    setFormOpen(true);
  };

  const closeForm = () => {
    if (
      !submitting &&
      (formData.namePrefix ||
        formData.nationality ||
        formData.passportNo ||
        formData.passportName ||
        reason) &&
      !window.confirm("ปิดโดยไม่บันทึกข้อมูล Passport หรือไม่?")
    ) {
      return;
    }
    setFormOpen(false);
  };

  const submitPassport = async () => {
    if (
      !formData.namePrefix ||
      !formData.nationality ||
      !formData.passportNo.trim() ||
      !formData.passportName.trim()
    ) {
      toast.error("กรุณากรอกข้อมูล Passport ให้ครบทุกช่อง");
      return;
    }
    if (editingGuestId && !reason.trim()) {
      toast.error("กรุณาระบุเหตุผลที่แก้ไข");
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        expectedRevision: revisionRef.current,
        passportData: formData,
        ...(editingGuestId ? { reason: reason.trim() } : {}),
      };
      let nextRevision: number;
      if (editingGuestId) {
        const response = await axios.patch<{ revision: number }>(
          `${API_URL}/bookings/${bookingId}/additional-guests/${editingGuestId}`,
          payload,
          { withCredentials: true },
        );
        nextRevision = response.data.revision;
      } else {
        const response = await axios.post<{
          revision: number;
          guest: GuestSummary;
        }>(`${API_URL}/bookings/${bookingId}/additional-guests`, payload, {
          withCredentials: true,
        });
        setGuests((current) => [...current, response.data.guest]);
        nextRevision = response.data.revision;
      }
      applyRevision(nextRevision);
      hidePassport();
      setFormOpen(false);
      toast.success(
        editingGuestId
          ? "แก้ไข Passport ผู้เข้าพักแล้ว"
          : "เพิ่ม Passport ผู้เข้าพักแล้ว",
      );
    } catch (err) {
      toast.error(errorMessage(err, "ไม่สามารถบันทึก Passport ได้"));
    } finally {
      setSubmitting(false);
    }
  };

  const removeGuest = async () => {
    if (!revealedGuestId) return;
    const removalReason = window.prompt("ระบุเหตุผลที่ลบ Passport นี้");
    if (!removalReason?.trim()) return;
    if (!window.confirm("ยืนยันการลบ Passport ผู้เข้าพักรายการนี้?")) return;

    try {
      setSubmitting(true);
      const response = await axios.delete<{ revision: number }>(
        `${API_URL}/bookings/${bookingId}/additional-guests/${revealedGuestId}`,
        {
          withCredentials: true,
          data: {
            expectedRevision: revisionRef.current,
            reason: removalReason.trim(),
          },
        },
      );
      setGuests((current) =>
        current.filter((guest) => guest.guestId !== revealedGuestId),
      );
      applyRevision(response.data.revision);
      hidePassport();
      toast.success("ลบ Passport ผู้เข้าพักแล้ว");
    } catch (err) {
      toast.error(errorMessage(err, "ไม่สามารถลบ Passport ได้"));
    } finally {
      setSubmitting(false);
    }
  };

  const isThaiGuest = formData.nationality === "TH";
  const prefixOptions = isThaiGuest
    ? thaiNamePrefixOptions
    : foreignNamePrefixOptions;

  return (
    <div className="viewBooking__item passportView__section additionalGuestsPassport">
      {guests.length > 0 ? (
        <>
          <div className="passportView__sectionHeader">
            <span className="viewBooking__label">Passport เพิ่มเติม</span>
            <span className="passportView__countTag">{guests.length}</span>
          </div>
          <div className="additionalGuestsPassport__list">
            {guests.map((guest, index) => {
            const isRevealed =
              revealedGuestId === guest.guestId && revealedPassport;
            const revealedIsThai = revealedPassport?.nationality === "TH";

            return isRevealed ? (
              <div
                className="passportView passportView__nonHidden"
                key={guest.guestId}
              >
                <div className="passportView__content">
                  <div className="passportView__row">
                    <span>
                      {revealedIsThai
                        ? "เลขประจำตัวประชาชน"
                        : "เลข Passport"}
                    </span>
                    <p>{revealedPassport.passportNo}</p>
                  </div>
                  <div className="passportView__row">
                    <span>
                      {revealedIsThai
                        ? "ชื่อ-นามสกุลภาษาไทย"
                        : "ชื่อ-นามสกุล Passport"}
                    </span>
                    <p>
                      {revealedPassport.namePrefix || "-"}{" "}
                      {revealedPassport.passportName}
                    </p>
                  </div>
                  <div className="passportView__row">
                    <span>สัญชาติ</span>
                    <p>{revealedPassport.nationality}</p>
                  </div>
                  <div className="passportView__actions">
                    <button
                      type="button"
                      className="passportView__hideButton"
                      onClick={openEditForm}
                    >
                      <i className="bx bx-edit" /> แก้ไข
                    </button>
                    <button
                      type="button"
                      className="passportView__hideButton additionalGuestsPassport__remove"
                      onClick={() => void removeGuest()}
                    >
                      <i className="bx bx-trash" /> ลบ
                    </button>
                    <button
                      type="button"
                      className="passportView__hideButton"
                      onClick={hidePassport}
                    >
                      <i className="bx bx-eye-slash" /> ซ่อน
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="passportView passportView__hidden"
                key={guest.guestId}
                onClick={() => void revealPassport(guest.guestId)}
                disabled={revealingGuestId === guest.guestId}
              >
                <i
                  className={`bx ${
                    revealingGuestId === guest.guestId
                      ? "bx-loader-lines bx-spin"
                      : "bx-lock"
                  }`}
                />
                <span>ผู้เข้าพัก {index + 1}</span>
                <small>
                  {revealingGuestId === guest.guestId
                    ? "กำลังโหลด..."
                    : "กดเพื่อดู"}
                </small>
              </button>
            );
            })}
          </div>
        </>
      ) : null}

      <button
        type="button"
        className="additionalGuestsPassport__add"
        onClick={openAddForm}
        disabled={loading}
      >
        <i className="bx bx-plus" />
        เพิ่ม Passport
      </button>

      <Modal open={formOpen} onClose={closeForm} className="home__modalCenter">
        <div className="additionalGuestsPassport__modal">
          <ModalCloseButton onClick={closeForm} />
          <h1 className="addBooking__title">
            {editingGuestId
              ? "แก้ไข Passport ผู้เข้าพัก"
              : "เพิ่ม Passport ผู้เข้าพัก"}
          </h1>

          <div className="additionalGuestsPassport__form">
            <div>
              <label>สัญชาติ</label>
              <Select<OptionType>
                styles={customStyles<OptionType>()}
                options={nationalityOptions}
                value={nationalityOptions.find(
                  (option) => option.value === formData.nationality,
                )}
                onChange={(option) => {
                  const nationality = option?.value || "";
                  const nextIsThai = nationality === "TH";
                  const nextPrefixes = nextIsThai
                    ? thaiNamePrefixOptions
                    : foreignNamePrefixOptions;
                  setFormData((current) => ({
                    ...current,
                    nationality,
                    namePrefix: nextPrefixes.some(
                      (prefix) => prefix.value === current.namePrefix,
                    )
                      ? current.namePrefix
                      : "",
                    passportNo:
                      nextIsThai === isThaiGuest ? current.passportNo : "",
                  }));
                }}
              />
            </div>
            <div className="additionalGuestsPassport__nameFields">
              <div>
                <label>คำนำหน้า</label>
                <Select<OptionType>
                  styles={customStyles<OptionType>()}
                  options={prefixOptions}
                  value={prefixOptions.find(
                    (option) => option.value === formData.namePrefix,
                  )}
                  onChange={(option) =>
                    setFormData((current) => ({
                      ...current,
                      namePrefix: option?.value || "",
                    }))
                  }
                  placeholder="เลือก"
                />
              </div>
              <div>
                <label>
                  {isThaiGuest
                    ? "ชื่อ-นามสกุลภาษาไทย"
                    : "ชื่อ-นามสกุล Passport"}
                </label>
                <input
                  className="boxInput"
                  value={formData.passportName}
                  onChange={(event) =>
                    setFormData((current) => ({
                      ...current,
                      passportName: isThaiGuest
                        ? event.target.value
                        : event.target.value.toUpperCase(),
                    }))
                  }
                  placeholder={
                    isThaiGuest
                      ? "เช่น สมชาย กลาง ใจดี"
                      : "เช่น ROBERT BROWN"
                  }
                />
              </div>
            </div>
            <div>
              <label>
                {isThaiGuest ? "เลขประจำตัวประชาชน" : "เลข Passport"}
              </label>
              <input
                className="boxInput"
                value={formData.passportNo}
                inputMode={isThaiGuest ? "numeric" : undefined}
                maxLength={isThaiGuest ? 13 : undefined}
                placeholder={
                  isThaiGuest ? "เลข 13 หลัก" : "เช่น A12345678"
                }
                onChange={(event) =>
                  setFormData((current) => ({
                    ...current,
                    passportNo: isThaiGuest
                      ? event.target.value.replace(/\D/g, "").slice(0, 13)
                      : event.target.value,
                  }))
                }
              />
            </div>
            {editingGuestId && (
              <div>
                <label>เหตุผลที่แก้ไข</label>
                <textarea
                  className="boxInput"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="เช่น อ่านเลข Passport ผิด"
                />
              </div>
            )}
          </div>

          <div className="additionalGuestsPassport__modalActions">
            <ActionButton
              text={submitting ? "กำลังบันทึก..." : "บันทึก Passport"}
              icon={submitting ? "bx-loader-lines" : "bx-save"}
              highlight
              disabled={submitting}
              onClick={() => void submitPassport()}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default AdditionalGuestsPassport;
