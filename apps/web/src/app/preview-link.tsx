import { Link, type LinkProps } from "react-router-dom";
/** Fixtures stay under /preview; following a link never silently switches data modes. */
export function PreviewLink({ to, ...props }: LinkProps) {
  return (
    <Link
      {...props}
      to={
        typeof to === "string" &&
        to.startsWith("/") &&
        !to.startsWith("/preview")
          ? `/preview${to}`
          : to
      }
    />
  );
}
