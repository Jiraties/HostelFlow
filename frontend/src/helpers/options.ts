import type { OptionType } from "./selectStyling";
import { formatShortRoomName } from "./roomStayHelpers";

export const platformOptions = [
  { value: "BOOK", label: "Booking.com", color: "#003580" },
  { value: "HOST", label: "Hostelworld", color: "#F15A24" },
  { value: "AGOD", label: "Agoda", color: "#19AC5B" },
  { value: "TRAV", label: "Traveloka", color: "#00ADEF" },
  { value: "WALK", label: "Walk-In", color: "#f12424" },
];

export const paymentMethodOptions = [
  { value: "OTA", label: "OTA" },
  { value: "Cash", label: "Cash" },
  { value: "Unpaid", label: "Unpaid" },
  { value: "Card", label: "Card" },
  { value: "Transfer", label: "Transfer" },
];

export const roomIdOptions: OptionType[] = [
  { value: "Balcony", label: "Balcony" },
  { value: "Window", label: "Window" },
  { value: "Pottery 1", label: "Pottery 1" },
  { value: "Pottery 2", label: "Pottery 2" },

  { value: "Siesta 1", label: "Siesta 1" },
  { value: "Siesta 2", label: "Siesta 2" },
  { value: "Siesta 3", label: "Siesta 3" },
  { value: "Siesta 4", label: "Siesta 4" },
  { value: "Siesta 5", label: "Siesta 5" },
  { value: "Siesta 6", label: "Siesta 6" },
  { value: "Siesta 7", label: "Siesta 7" },
  { value: "Siesta 8", label: "Siesta 8" },
  { value: "Siesta 9", label: "Siesta 9" },
  { value: "Siesta 10", label: "Siesta 10" },
  { value: "Siesta 11", label: "Siesta 11" },
  { value: "Siesta 12", label: "Siesta 12" },
  { value: "Siesta 13", label: "Siesta 13" },
  { value: "Siesta 14", label: "Siesta 14" },

  { value: "Marquisette 1", label: "Marquisette 1" },
  { value: "Marquisette 2", label: "Marquisette 2" },
  { value: "Marquisette 3", label: "Marquisette 3" },
  { value: "Marquisette 4", label: "Marquisette 4" },
  { value: "Marquisette 5", label: "Marquisette 5" },
  { value: "Marquisette 6", label: "Marquisette 6" },
  { value: "Marquisette 7", label: "Marquisette 7" },
  { value: "Marquisette 8", label: "Marquisette 8" },

  { value: "Homespan 1", label: "Homespan 1" },
  { value: "Homespan 2", label: "Homespan 2" },
  { value: "Homespan 3", label: "Homespan 3" },
  { value: "Homespan 4", label: "Homespan 4" },
  { value: "Homespan 5", label: "Homespan 5" },
  { value: "Homespan 6", label: "Homespan 6" },
  { value: "Homespan 7", label: "Homespan 7" },
  { value: "Homespan 8", label: "Homespan 8" },

  { value: "Veranda 1", label: "Veranda 1" },
  { value: "Veranda 2", label: "Veranda 2" },
  { value: "Veranda 3", label: "Veranda 3" },
  { value: "Veranda 4", label: "Veranda 4" },
  { value: "Veranda 5", label: "Veranda 5" },
  { value: "Veranda 6", label: "Veranda 6" },

  { value: "Wicker 1", label: "Wicker 1" },
  { value: "Wicker 2", label: "Wicker 2" },
  { value: "Wicker 3", label: "Wicker 3" },
  { value: "Wicker 4", label: "Wicker 4" },
  { value: "Wicker 5", label: "Wicker 5" },
  { value: "Wicker 6", label: "Wicker 6" },
].map((option) => ({ ...option, label: formatShortRoomName(option.value) }));
