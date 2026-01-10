export class CreateUserDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;    // The ? makes it optional
  address?: string;  // The ? makes it optional
  role?: string;     // Optional role (ADMIN, LEADER, MEMBER, GUEST)
}