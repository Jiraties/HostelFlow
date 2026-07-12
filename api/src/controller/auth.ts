import bcrypt from "bcrypt";
import User from "../models/user";
import { defaultUserSettings } from "../models/user";
import type { UserSettings } from "../models/user";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { Request, Response, NextFunction } from "express";
import { logActivity } from "../services/activityServices";
import { randomUUID } from "crypto";
import type { MyJwtPayload } from "../middleware/authMiddleware";

dotenv.config();

const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;

const activeSessionError = {
  error: "บัญชีนี้กำลังใช้งานอยู่บนอุปกรณ์อื่น กรุณาออกจากระบบบนอุปกรณ์เดิมก่อน",
  code: "ACTIVE_SESSION_EXISTS",
};

const normalizeUserSettings = (settings?: Partial<UserSettings>) => ({
  calendarColorMode:
    settings?.calendarColorMode || defaultUserSettings.calendarColorMode,
  calendarDensity: settings?.calendarDensity || defaultUserSettings.calendarDensity,
  tableDensity: settings?.tableDensity || defaultUserSettings.tableDensity,
  defaultPlatformId:
    settings?.defaultPlatformId ?? defaultUserSettings.defaultPlatformId,
  defaultPaymentMethod:
    settings?.defaultPaymentMethod ?? defaultUserSettings.defaultPaymentMethod,
  dateFormat: settings?.dateFormat || defaultUserSettings.dateFormat,
});

const sanitizeUser = (user: {
  _id: unknown;
  username: string;
  name: string;
  admin: boolean;
  active?: boolean;
  profilePictureUrl?: string;
  settings?: Partial<UserSettings>;
}) => {
  const settings =
    user.settings && typeof (user.settings as any).toObject === "function"
      ? (user.settings as any).toObject()
      : user.settings;

  return {
    userId: String(user._id),
    username: user.username,
    name: user.name,
    admin: user.admin,
    active: user.active !== false,
    profilePictureUrl: user.profilePictureUrl || "/uploads/default.jpg",
    settings: normalizeUserSettings(settings),
  };
};

const settingsOptions = {
  calendarColorMode: ["status", "source"],
  calendarDensity: ["compact", "comfortable", "spacious"],
  tableDensity: ["compact", "comfortable", "spacious"],
  defaultPlatformId: ["", "BOOK", "HOST", "TRAV", "AGOD", "WALK"],
  defaultPaymentMethod: ["", "OTA", "Cash", "Card", "Transfer", "Unpaid"],
  dateFormat: ["dd/MM/yyyy", "d MMM yyyy"],
} satisfies Record<keyof UserSettings, readonly string[]>;

const normalizeSettingsUpdate = (body: Partial<UserSettings>) => {
  const updates: Partial<UserSettings> = {};

  (Object.keys(settingsOptions) as (keyof UserSettings)[]).forEach((key) => {
    const value = body[key];
    if (value === undefined) return;

    if (!settingsOptions[key].includes(value)) {
      throw new Error("ค่าการตั้งค่าไม่ถูกต้อง");
    }

    updates[key] = value as never;
  });

  return updates;
};

export const listUsers = async (req: Request, res: Response) => {
  try {
    if (!req.user?.admin) {
      return res.status(403).json({
        message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดูผู้ใช้ได้",
      });
    }

    const users = await User.find({})
      .select("_id username name admin active profilePictureUrl")
      .sort({ username: 1 });

    res.status(200).json({ users: users.map(sanitizeUser) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const adminCreateUser = async (req: Request, res: Response) => {
  try {
    if (!req.user?.admin) {
      return res.status(403).json({
        message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถสร้างผู้ใช้ได้",
      });
    }

    const { username, password, admin = false, name } = req.body;

    if (!username || !password || !name) {
      return res.status(400).json({
        message: "กรุณากรอกชื่อผู้ใช้ ชื่อพนักงาน และรหัสผ่านให้ครบ",
      });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(409).json({
        message: "ชื่อผู้ใช้นี้ถูกใช้งานแล้ว",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      password: hashedPassword,
      admin: Boolean(admin),
      active: true,
      name,
    });

    await logActivity(req.user.username, "CREATE_USER", {
      summary: {
        createdUsername: username,
        createdName: name,
        admin: Boolean(admin),
      },
    });

    res.status(201).json({
      message: "สร้างผู้ใช้เรียบร้อยแล้ว",
      user: sanitizeUser(user),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const resetUserPassword = async (req: Request, res: Response) => {
  try {
    if (!req.user?.admin) {
      return res.status(403).json({
        message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถเปลี่ยนรหัสผ่านได้",
      });
    }

    const { userId } = req.params;
    const { password } = req.body;

    if (!userId || !password) {
      return res.status(400).json({
        message: "กรุณาระบุผู้ใช้และรหัสผ่านใหม่",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.findByIdAndUpdate(
      userId,
      {
        $set: { password: hashedPassword },
        $unset: { currentSessionId: "", currentSessionIssuedAt: "" },
      },
      { returnDocument: "after" },
    ).select("_id username name admin active profilePictureUrl");

    if (!user) {
      return res.status(404).json({
        message: "ไม่พบผู้ใช้",
      });
    }

    await logActivity(req.user.username, "RESET_USER_PASSWORD", {
      summary: {
        resetUsername: user.username,
        resetName: user.name,
      },
    });

    res.status(200).json({
      message: "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว",
      user: sanitizeUser(user),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const updateUser = async (req: Request, res: Response) => {
  try {
    if (!req.user?.admin) {
      return res.status(403).json({
        message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถแก้ไขผู้ใช้ได้",
      });
    }

    const { userId } = req.params;
    const { name, admin, active } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "กรุณาระบุผู้ใช้" });
    }

    const existingUser = await User.findById(userId);
    if (!existingUser) {
      return res.status(404).json({ message: "ไม่พบผู้ใช้" });
    }

    const isSelf = req.user.userId === userId;
    if (isSelf && admin === false) {
      return res.status(400).json({
        message: "ไม่สามารถถอดสิทธิ์ Admin ของตัวเองได้",
      });
    }

    if (isSelf && active === false) {
      return res.status(400).json({
        message: "ไม่สามารถปิดใช้งานบัญชีตัวเองได้",
      });
    }

    const updates: Partial<{
      name: string;
      admin: boolean;
      active: boolean;
    }> = {};
    const unsets: Partial<{
      currentSessionId: "";
      currentSessionIssuedAt: "";
    }> = {};
    const changes: Record<string, { before: unknown; after: unknown }> = {};

    if (typeof name === "string") {
      const trimmedName = name.trim();
      if (!trimmedName) {
        return res.status(400).json({ message: "กรุณากรอกชื่อพนักงาน" });
      }

      if (trimmedName !== existingUser.name) {
        updates.name = trimmedName;
        changes.name = { before: existingUser.name, after: trimmedName };
      }
    }

    if (typeof admin === "boolean" && admin !== existingUser.admin) {
      updates.admin = admin;
      changes.admin = { before: existingUser.admin, after: admin };
    }

    const existingActive = existingUser.active !== false;
    if (typeof active === "boolean" && active !== existingActive) {
      updates.active = active;
      changes.active = { before: existingActive, after: active };

      if (active === false) {
        unsets.currentSessionId = "";
        unsets.currentSessionIssuedAt = "";
      }
    }

    if (Object.keys(updates).length === 0 && Object.keys(unsets).length === 0) {
      return res.status(200).json({
        message: "ไม่มีข้อมูลที่เปลี่ยนแปลง",
        user: sanitizeUser(existingUser),
      });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        ...(Object.keys(updates).length ? { $set: updates } : {}),
        ...(Object.keys(unsets).length ? { $unset: unsets } : {}),
      },
      { returnDocument: "after" },
    ).select("_id username name admin active profilePictureUrl");

    if (!updatedUser) {
      return res.status(404).json({ message: "ไม่พบผู้ใช้" });
    }

    const action =
      updates.active === false
        ? "DEACTIVATE_USER"
        : updates.active === true
          ? "REACTIVATE_USER"
          : "UPDATE_USER";

    await logActivity(req.user.username, action, {
      changes,
      summary: {
        targetUsername: updatedUser.username,
        targetName: updatedUser.name,
      },
    });

    res.status(200).json({
      message: "อัปเดตผู้ใช้เรียบร้อยแล้ว",
      user: sanitizeUser(updatedUser),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
};

export const updateMySettings = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });

    const updates = normalizeSettingsUpdate(req.body || {});

    if (Object.keys(updates).length === 0) {
      const user = await User.findById(req.user.userId).select(
        "_id username name admin active profilePictureUrl settings",
      );

      if (!user) return res.status(404).json({ message: "ไม่พบผู้ใช้" });

      return res.status(200).json({
        message: "ไม่มีข้อมูลที่เปลี่ยนแปลง",
        user: sanitizeUser(user),
      });
    }

    const $set = Object.fromEntries(
      Object.entries(updates).map(([key, value]) => [`settings.${key}`, value]),
    );

    const updatedUser = await User.findByIdAndUpdate(
      req.user.userId,
      { $set },
      { returnDocument: "after" },
    ).select("_id username name admin active profilePictureUrl settings");

    if (!updatedUser) return res.status(404).json({ message: "ไม่พบผู้ใช้" });

    logActivity(req.user.username, "UPDATE_USER_SETTINGS", {
      summary: {
        updatedSettings: Object.keys(updates),
      },
    }).catch((err) => {
      console.error("Failed to log settings update activity", err);
    });

    return res.status(200).json({
      message: "บันทึกการตั้งค่าเรียบร้อยแล้ว",
      user: sanitizeUser(updatedUser),
    });
  } catch (err) {
    return res.status(400).json({ message: (err as Error).message });
  }
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { username, password } = req.body;

    if (!username || !password)
      return res.status(400).json({ error: "กรุณากรอกอีเมลและรหัสผ่านให้ครบ" });

    const user = await User.findOne({ username });
    if (!user)
      return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });

    if (user.active === false) {
      logActivity(username, "LOGIN", { success: false });
      return res.status(403).json({
        error: "บัญชีผู้ใช้นี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ",
      });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      logActivity(username, "LOGIN", { success: false });
      throw new Error("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
    }

    if (!process.env.JWT_SECRET)
      throw new Error("JWT_SECRET not found serverside");

    const now = new Date();
    const sessionCutoff = new Date(now.getTime() - SESSION_LIFETIME_MS);
    let requestSessionId: string | undefined;

    if (req.cookies.token) {
      try {
        const existingToken = jwt.verify(
          req.cookies.token,
          process.env.JWT_SECRET,
        ) as MyJwtPayload;
        if (
          String(existingToken.userId) === String(user._id) &&
          existingToken.sessionId === user.currentSessionId
        ) {
          requestSessionId = existingToken.sessionId;
        }
      } catch {
        // An expired or invalid cookie does not own the active session.
      }
    }

    const sessionId = requestSessionId || randomUUID();
    const sessionUser = await User.findOneAndUpdate(
      requestSessionId
        ? { _id: user._id, currentSessionId: requestSessionId }
        : {
            _id: user._id,
            $or: [
              { currentSessionId: { $exists: false } },
              { currentSessionId: null },
              { currentSessionIssuedAt: { $exists: false } },
              { currentSessionIssuedAt: { $lte: sessionCutoff } },
            ],
          },
      {
        $set: {
          currentSessionId: sessionId,
          currentSessionIssuedAt: now,
        },
      },
      { returnDocument: "after" },
    );

    if (!sessionUser) {
      logActivity(username, "LOGIN", { success: false }).catch(() => {});
      return res.status(409).json(activeSessionError);
    }

    const token = jwt.sign(
      {
        userId: user._id,
        admin: sessionUser.admin,
        username: sessionUser.username,
        sessionId,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d",
      },
    );

    res.cookie("token", token, authCookieOptions);

    res.status(200).json({
      message: "Logged In Successfully.",
      user: sanitizeUser(sessionUser),
    });

    logActivity(username, "LOGIN", { success: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
};

export const me = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Not Authorized" });

    const user = await User.findById(req.user?.userId);

    if (!user) throw new Error("Token authorized but user not found.");

    res.status(200).json({
      user: sanitizeUser(user),
      message: "Successfully fetched user info",
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
};

export const logout = async (req: Request, res: Response) => {
  if (req.user?.userId && req.user.sessionId) {
    await User.updateOne(
      { _id: req.user.userId, currentSessionId: req.user.sessionId },
      { $unset: { currentSessionId: "", currentSessionIssuedAt: "" } },
    );
  }

  res.clearCookie("token", authCookieOptions);

  res.status(200).json({ message: "Successfully logged out" });

  logActivity(req.user?.username, "LOGOUT", { success: true });
};

export const setProfilePicture = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });

    if (!req.file) return res.status(400).json({ message: "กรุณาอัปโหลดภาพ" });

    const profilePictureUrl = `/uploads/profile-pictures/${req.file.filename}`;

    const updatedUser = await User.findByIdAndUpdate(
      req.user.userId,
      {
        $set: {
          profilePictureUrl,
        },
      },
      { returnDocument: "after" },
    );

    if (!updatedUser) return res.status(404).json({ message: "ไม่พบผู้ใช้" });

    return res.status(200).json({
      message: "อัปเดตรูปโปรไฟล์เรียบร้อยแล้ว",
      user: sanitizeUser(updatedUser),
    });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
};
