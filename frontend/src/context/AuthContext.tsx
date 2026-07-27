import axios from "axios";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { API_URL } from "../config/api";
import {
  normalizeUserSettings,
  type UserSettings,
} from "../types/userSettings";

interface userType {
  userId?: string;
  username: string;
  admin: boolean;
  active?: boolean;
  name: string;
  profilePictureUrl?: string;
  settings: UserSettings;
}

type AuthUserPayload = Omit<userType, "settings"> & {
  settings?: Partial<UserSettings>;
};

type AuthContextType = {
  isAuthenticated: boolean;
  user: userType | null;
  login: (user: AuthUserPayload) => void;
  logout: () => void;
  resolveStaffName: (username?: string | null) => string;
};

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  user: null,
  login: () => {},
  logout: () => {},
  resolveStaffName: () => "ไม่ทราบชื่อพนักงาน",
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<userType | null>(null);
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const loggedInUsername = user?.username;

  useEffect(() => {
    if (!loggedInUsername) return;

    const controller = new AbortController();
    axios
      .get<{ staff: Array<{ username: string; name?: string }> }>(
        `${API_URL}/auth/staff-directory`,
        { withCredentials: true, signal: controller.signal },
      )
      .then((response) => {
        setStaffNames(
          Object.fromEntries(
            response.data.staff
              .filter((member) => member.username && member.name?.trim())
              .map((member) => [member.username, member.name!.trim()]),
          ),
        );
      })
      .catch((error: unknown) => {
        if (!axios.isCancel(error)) setStaffNames({});
      });

    return () => controller.abort();
  }, [loggedInUsername]);

  const login = (userData: AuthUserPayload) => {
    setUser({
      ...userData,
      settings: normalizeUserSettings(userData.settings),
    });
  };

  const logout = () => {
    setUser(null);
    setStaffNames({});
  };
  const resolveStaffName = useCallback(
    (username?: string | null) => {
      if (!username) return "ไม่ทราบชื่อพนักงาน";
      if (staffNames[username]) return staffNames[username];
      if (username === user?.username && user.name?.trim()) {
        return user.name.trim();
      }
      return "ไม่ทราบชื่อพนักงาน";
    },
    [staffNames, user?.name, user?.username],
  );

  return (
    <AuthContext.Provider
      value={{ isAuthenticated: !!user, user, login, logout, resolveStaffName }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};
