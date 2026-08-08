import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
} from "react";
import { Modal } from "@mui/material";
import { useNavigate } from "react-router";
import toast from "react-hot-toast";
import type { booking } from "../types/bookingTypes";
import { resolveSearchDestination } from "../helpers/searchDestinations";
import {
  CommandPaletteContext,
  type PaletteMode,
} from "./commandPalette";

const GlobalSearchPalette = lazy(
  () => import("../features/search/GlobalSearchPalette"),
);
const AddBooking = lazy(() => import("../features/bookings/AddBooking"));
const StandaloneSaleModal = lazy(
  () => import("../features/finance/StandaloneSaleModal"),
);

export const CommandPaletteProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PaletteMode>("search");
  const [addBookingOpen, setAddBookingOpen] = useState(false);
  const [standaloneSaleOpen, setStandaloneSaleOpen] = useState(false);

  const openPalette = useCallback((nextMode: PaletteMode = "search") => {
    if (document.querySelector(".MuiModal-root")) return;
    setMode(nextMode);
    setOpen(true);
  }, []);
  const closePalette = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.key.toLowerCase() !== "k" ||
        (!event.metaKey && !event.ctrlKey)
      ) {
        return;
      }
      event.preventDefault();
      openPalette();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openPalette]);

  const openAddBooking = useCallback(() => {
    setOpen(false);
    setAddBookingOpen(true);
  }, []);
  const openStandaloneSale = useCallback(() => {
    setOpen(false);
    setStandaloneSaleOpen(true);
  }, []);
  const pickBookingForTransaction = useCallback(() => {
    setMode("bookingPick");
  }, []);
  const pickCheckInDate = useCallback(() => {
    setMode("checkInDate");
  }, []);
  const pickCheckOutDate = useCallback(() => {
    setMode("checkOutDate");
  }, []);
  const clearPaletteMode = useCallback(() => {
    setMode("search");
  }, []);
  const toggleCommandMode = useCallback(() => {
    setMode((currentMode) =>
      currentMode === "commands" ? "search" : "commands",
    );
  }, []);

  const handleBookingCreated = useCallback(
    (createdBooking: booking) => {
      setAddBookingOpen(false);
      navigate(
        resolveSearchDestination({
          kind: "booking",
          bookingId: createdBooking.bookingId,
        }),
      );
    },
    [navigate],
  );

  return (
    <CommandPaletteContext.Provider value={{ openPalette, closePalette }}>
      {children}
      <Suspense fallback={null}>
        {open && (
          <GlobalSearchPalette
            open
            mode={mode}
            onClose={closePalette}
            onOpenAddBooking={openAddBooking}
            onOpenStandaloneSale={openStandaloneSale}
            onPickBookingForTransaction={pickBookingForTransaction}
            onPickCheckInDate={pickCheckInDate}
            onPickCheckOutDate={pickCheckOutDate}
            onClearMode={clearPaletteMode}
            onToggleCommandMode={toggleCommandMode}
          />
        )}
        <Modal
          open={addBookingOpen}
          className="home__modalCenter"
          onClose={() => setAddBookingOpen(false)}
        >
          <AddBooking
            appendToBookings={handleBookingCreated}
            onClose={() => setAddBookingOpen(false)}
          />
        </Modal>
        <Modal
          open={standaloneSaleOpen}
          className="home__modalCenter"
          onClose={() => setStandaloneSaleOpen(false)}
        >
          <StandaloneSaleModal
            onClose={() => setStandaloneSaleOpen(false)}
            onSaved={() => toast.success("บันทึกรายการแล้ว")}
          />
        </Modal>
      </Suspense>
    </CommandPaletteContext.Provider>
  );
};
