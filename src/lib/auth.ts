import md5 from "md5";

const API_VERSION = "1.16.1";
const CLIENT = "Icosahedron";

export function buildCoverQs(username: string, password: string): string {
  const salt = Math.random().toString(36).slice(2, 10);
  const token = md5(password + salt);
  return `u=${encodeURIComponent(username)}&t=${token}&s=${salt}&v=${API_VERSION}&c=${CLIENT}`;
}
