// Landing Page - Redirect to login
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/login');
}
