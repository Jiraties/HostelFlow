import { createContext, useContext, useState } from "react";

interface userType {
  userId?: string;
  username: string;
  admin: boolean;
  active?: boolean;
  name: string;
  profilePictureUrl?: string;
}

type AuthContextType = {
  isAuthenticated: boolean;
  user: userType | null;
  login: (user: userType) => void;
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

  const login = (userData: userType) => {
    setUser(userData);
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
