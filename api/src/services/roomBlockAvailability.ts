import type { ClientSession } from "mongoose";
import RoomBlock from "../models/roomBlock";
import { getRoomStayRoomIds } from "../helpers/roomStayHelpers";

export type RoomRange = {
  roomId?: string;
  roomIds?: string[];
  from: string | Date;
  to: string | Date;
};

const activeRoomBlockQuery = (ranges: RoomRange[]) => ({
  releasedAt: { $exists: false },
  $or: ranges.map((range) => {
    const roomIds = getRoomStayRoomIds(range);
    return {
      $and: [
        {
          $or: [
            { roomIds: { $in: roomIds } },
            { roomId: { $in: roomIds } },
          ],
        },
        {
          from: { $lt: new Date(range.to) },
          to: { $gt: new Date(range.from) },
        },
      ],
    };
  }),
});

export const findActiveRoomBlockConflict = async (
  ranges: RoomRange[],
  session?: ClientSession,
) => {
  if (!ranges.length) return null;
  const query = RoomBlock.findOne(activeRoomBlockQuery(ranges));
  if (session) query.session(session);
  return query.lean();
};

export const getActiveBlockedRoomIds = async (from: Date, to: Date) => {
  const blocks = await RoomBlock.find({
    releasedAt: { $exists: false },
    from: { $lt: to },
    to: { $gt: from },
  })
    .select("roomId roomIds")
    .lean();

  return Array.from(
    new Set(blocks.flatMap((block) => getRoomStayRoomIds(block))),
  );
};
