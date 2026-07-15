import type { PlatformId } from "../types/bookingTypes";
import agodaLogo from "../../assets/images/agoda.png";
import bookingLogo from "../../assets/images/booking.jpeg";
import hostelworldLogo from "../../assets/images/hostelworld.png";
import travelokaLogo from "../../assets/images/traveloka.jpg";
import walkInLogo from "../../assets/images/walkIn.png";

type platformMapItem = {
  label: string;
  color: string;
  logo: string;
};

export const platformMap: Record<PlatformId, platformMapItem> = {
  BOOK: {
    label: "Booking.com",
    color: "#003580",
    logo: bookingLogo,
  },
  AGOD: {
    label: "Agoda",
    color: "#19AC5B",

    logo: agodaLogo,
  },
  TRAV: {
    label: "Traveloka",
    color: "#00ADEF",
    logo: travelokaLogo,
  },
  HOST: {
    label: "Hostelworld",
    color: "#F15A24",
    logo: hostelworldLogo,
  },
  WALK: {
    label: "Walk-In",
    color: "#f12424",
    logo: walkInLogo,
  },
};
