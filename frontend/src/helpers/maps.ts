import type { PlatformId } from "../types/bookingTypes";

type platformMapItem = {
  label: string;
  color: string;
  logo: string;
};

export const platformMap: Record<PlatformId, platformMapItem> = {
  BOOK: {
    label: "Booking.com",
    color: "#003580",
    logo: "../../../assets/images/booking.jpeg",
  },
  AGOD: {
    label: "Agoda",
    color: "#19AC5B",

    logo: "../../../assets/images/agoda.png",
  },
  TRAV: {
    label: "Traveloka",
    color: "#00ADEF",
    logo: "../../../assets/images/traveloka.jpg",
  },
  HOST: {
    label: "Hostelworld",
    color: "#F15A24",
    logo: "../../../assets/images/hostelworld.png",
  },
  WALK: {
    label: "Walk-In",
    color: "#f12424",
    logo: "../../../assets/images/walkIn.png",
  },
};
