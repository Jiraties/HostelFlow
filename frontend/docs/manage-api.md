# Manage Page API Reference

All endpoints require the normal auth cookie. These admin endpoints return `403`
when the logged-in user is not an admin.

## List Users

`GET /auth/users`

Returns staff/admin users without password hashes.

```ts
type Response = {
  users: Array<{
    userId: string;
    username: string;
    name: string;
    admin: boolean;
  }>;
};
```

## Create User

`POST /auth/admin/createUser`

Creates a staff or admin user. Does not require `SECRET_CODE`; only requires the
current user to be admin.

```ts
type Body = {
  username: string;
  name: string;
  password: string;
  admin: boolean;
};

type Response = {
  message: string;
  user: {
    userId: string;
    username: string;
    name: string;
    admin: boolean;
  };
};
```

Common errors:

- `400`: missing username, name, or password.
- `403`: logged-in user is not admin.
- `409`: username already exists.

## Reset User Password

`PATCH /auth/users/:userId/password`

Sets a new password for a user. The backend hashes it and never returns the hash.

```ts
type Body = {
  password: string;
};

type Response = {
  message: string;
  user: {
    userId: string;
    username: string;
    name: string;
    admin: boolean;
  };
};
```

Common errors:

- `400`: missing user id or password.
- `403`: logged-in user is not admin.
- `404`: user not found.

## Admin Activity Feed

`GET /activities/admin`

Returns all staff activity, newest first.

Query params:

```ts
type Query = {
  page?: number; // default 1
  limit?: number; // default 20, max 50
  staffUsername?: string;
  action?: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
};
```

```ts
type Response = {
  activities: Activity[];
  page: number;
  limit: number;
  totalActivityCount: number;
};
```

## Admin Activity Stats

`GET /activities/admin/stats`

Returns action counts by staff and action type. Defaults to the current month
when no date range is supplied.

Query params:

```ts
type Query = {
  staffUsername?: string;
  action?: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
};
```

```ts
type Response = {
  totalActions: number;
  byStaff: Array<{
    staffUsername: string;
    count: number;
  }>;
  byAction: Array<{
    action: string;
    count: number;
  }>;
};
```

## Frontend Notes

Use `withCredentials: true` on every request:

```ts
axios.get(`${API_URL}/auth/users`, { withCredentials: true });
```

After creating a user or resetting a password, refetch:

```ts
await fetchManageData();
```

Supported admin activity actions added for this page:

- `CREATE_USER`
- `RESET_USER_PASSWORD`
