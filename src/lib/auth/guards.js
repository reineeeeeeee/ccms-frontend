/** True when the user's role may open a page. No list means any signed-in role. The API checks again on the server. */
export function isRoleAllowed(user, allowedRoles) {
  return !allowedRoles || allowedRoles.includes(user.role);
}
