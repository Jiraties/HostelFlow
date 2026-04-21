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
    });

    await user.save();

    res.status(201).json({ message: "User created successfully" });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
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
    });

    res.status(200).json({
      message: "Logged In Successfully.",
      user: {
        username: user.username,
        name: user.name,
        admin: user.admin,
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
    sameSite: "strict",
  });

  res.status(200).json({ message: "Successfully logged out" });

  console.log(req.user);

  logActivity(req.user?.username, "LOGOUT", { success: true });
  console.log("Logged Out");
};
