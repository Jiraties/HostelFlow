export type DepositRequirementBooking = {
  bookingId: string;
  guestName: string;
  checkOut: string | Date;
  amount: number;
};

export type DepositRequirement = {
  businessDate: string;
  total: number;
  checkoutCount: number;
  refundBookingCount: number;
  bookings: DepositRequirementBooking[];
  calculatedAt: string | Date;
};

export type DepositPreparation = {
  targetBusinessDate: string;
  requiredAmount: number;
  preparedAmount: number;
  adjustment: number;
  checkoutCount: number;
  refundBookingCount: number;
  bookings: DepositRequirementBooking[];
  calculatedAt: string | Date;
  preparedAt: string | Date;
  preparedBy: string;
};

export type CashShift = {
  _id: string;
  businessDate: string;
  shiftNumber: number;
  staffUsername: string;
  status: "open" | "closed";
  openingMode: "counted" | "accepted_handoff";
  handoffFromShiftId?: string;
  depositOpeningCash: number;
  operatingOpeningCash: number;
  depositCashIn: number;
  depositCashOut: number;
  operatingCashIn: number;
  operatingCashOut: number;
  depositExpectedCash: number;
  operatingExpectedCash: number;
  depositActualCash?: number;
  operatingActualCash?: number;
  depositVariance?: number;
  operatingVariance?: number;
  note?: string;
  startedAt: string | Date;
  endedAt?: string | Date;
  staff?: {
    username: string;
    name?: string;
    profilePictureUrl?: string;
  };
  closedBy?: {
    username: string;
    name?: string;
    profilePictureUrl?: string;
  };
  isFinalDayClose?: boolean;
  depositPreparation?: DepositPreparation;
};

export type CashPositionData = {
  businessDate: string;
  threshold: number;
  activeShift: CashShift | null;
  previousShift: CashShift | null;
  current: { depositCash: number; operatingCash: number };
  openingDepositRequirement: DepositRequirement;
  tomorrowDepositRequirement: DepositRequirement;
  preparedForToday:
    | (DepositPreparation & {
        sourceBusinessDate: string;
        sourceShiftNumber: number;
      })
    | null;
  handoff: {
    depositCash: number;
    operatingCash: number;
    fromShiftId?: string;
    fromShiftNumber?: number;
  };
  shifts: CashShift[];
};
