import { createContext, useContext, useState } from "react";
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
};

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  user: null,
  login: () => {},
  logout: () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<userType | null>(null);

  const login = (userData: AuthUserPayload) => {
    setUser({
      ...userData,
      settings: normalizeUserSettings(userData.settings),
    });
  };

  const logout = () => setUser(null);

  return (
    <AuthContext.Provider
      value={{ isAuthenticated: !!user, user, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};
