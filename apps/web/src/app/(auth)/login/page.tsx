import { Card } from '@/components/ui/card';
import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <Card title="Sign in">
      <h1 className="sr-only">Sign in to SomaOS</h1>
      <LoginForm />
    </Card>
  );
}
