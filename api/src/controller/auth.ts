import bcrypt from "bcrypt";
import User from "../models/user";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { Request, Response, NextFunction } from "express";
import { logActivity } from "../services/activityServices";

dotenv.config();

export const createUser = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const { username, password, secretCode, admin, name } = req.body;

    console.log(req.body);

    if (secretCode !== process.env.SECRET_CODE)
      throw new Error(
        "To create a new account please provide the correct secret code",
      );

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      username,
      password: hashedPassword,
      admin,
      name,
      profilePictureUrl: "/uploads/default.jpg",
    });

    await user.save();

    res.status(201).json({ message: "User created successfully" });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
};

const sanitizeUser = (user: {
  _id: unknown;
  username: string;
  name: string;
  admin: boolean;
  profilePictureUrl?: string;
}) => ({
  userId: String(user._id),
  username: user.username,
  name: user.name,
  admin: user.admin,
  profilePictureUrl: user.profilePictureUrl || "/uploads/default.jpg",
});

export const listUsers = async (req: Request, res: Response) => {
  try {
    if (!req.user?.admin) {
      return res.status(403).json({
        message: "เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถดูผู้ใช้ได้",
      });
    }

    const users = await User.find({})
      .select("_id username name admin profilePictureUrl")
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
      { $set: { password: hashedPassword } },
      { new: true },
    ).select("_id username name admin profilePictureUrl");

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

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    console.log("LOGGIN IN! ");
    const { username, password } = req.body;

    if (!username || !password)
      return res.status(400).json({ error: "กรุณากรอกอีเมลและรหัสผ่านให้ครบ" });

    const user = await User.findOne({ username });
    if (!user)
      return res.status(401).json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      logActivity(username, "LOGIN", { success: false });
      throw new Error("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
    }

    if (!process.env.JWT_SECRET)
      throw new Error("JWT_SECRET not found serverside");

    const token = jwt.sign(
      { userId: user._id, admin: user.admin, username: user.username },
      process.env.JWT_SECRET,
      {
        expiresIn: "1d",
      },
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
    });

    res.status(200).json({
      message: "Logged In Successfully.",
      user: {
        username: user.username,
        name: user.name,
        admin: user.admin,
        profilePictureUrl: user.profilePictureUrl,
      },
    });

    logActivity(username, "LOGIN", { success: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
};

export const me = async (req: Request, res: Response, next: NextFunction) => {
  try {
    console.log(req.user);

    if (!req.user) return res.status(401).json({ error: "Not Authorized" });

    const user = await User.findById(req.user?.userId);

    if (!user) throw new Error("Token authorized but user not found.");

    res.status(200).json({
      user: {
        username: user.username,
        name: user.name,
        admin: user.admin,
        profilePictureUrl: user.profilePictureUrl,
      },
      message: "Successfully fetched user info",
    });
  } catch (err) {
    res.status(400).json({ error: err });
  }
};

export const logout = (req: Request, res: Response) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
  });

  res.status(200).json({ message: "Successfully logged out" });

  console.log(req.user);

  logActivity(req.user?.username, "LOGOUT", { success: true });
  console.log("Logged Out");
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
      { new: true },
    );

    if (!updatedUser) return res.status(404).json({ message: "ไม่พบผู้ใช้" });

    return res.status(200).json({
      message: "อัปเดตรูปโปรไฟล์เรียบร้อยแล้ว",
      user: {
        username: updatedUser.username,
        name: updatedUser.name,
        admin: updatedUser.admin,
        profilePictureUrl: updatedUser.profilePictureUrl,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: (err as Error).message });
  }
};
