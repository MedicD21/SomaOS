import { Card } from '@/components/ui/card';
import { MfaForm } from './mfa-form';

export default function MfaPage() {
  return (
    <Card title="Two-step sign-in">
      <h1 className="sr-only">Two-step sign-in</h1>
      <MfaForm />
    </Card>
  );
}
