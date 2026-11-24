import type { FormHTMLAttributes, ReactNode } from 'react';

/**
 * A door, as a slip of paper: the foil along its top, a kicker over the heading to say what the slip is, the fields
 * and the one button on it, and under a perforation the stub, where what else one may do is (to sign up instead,
 * to ask for a new password). A page that has done what it was for (a link sent, a password set) is the same slip
 * with its sentence on it instead of its fields: `as="section"`.
 */
export function AuthCard({
  kicker,
  title,
  stub,
  as = 'form',
  children,
  ...form
}: {
  kicker: string;
  title: string;
  stub?: ReactNode;
  as?: 'form' | 'section';
  children: ReactNode;
} & Omit<FormHTMLAttributes<HTMLFormElement>, 'title'>) {
  const body = (
    <>
      <div className="auth-slip">
        <p className="auth-kicker">{kicker}</p>
        <h2>{title}</h2>
        {children}
      </div>
      {stub && <div className="auth-stub">{stub}</div>}
    </>
  );
  return as === 'form' ? (
    <form className="auth-card" {...form}>
      {body}
    </form>
  ) : (
    <section className="auth-card" aria-label={title}>
      {body}
    </section>
  );
}
