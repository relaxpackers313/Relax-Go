import { useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '@relaxgo/shared';
import { api, ApiError } from '@/lib/api';
import { colors } from '@/lib/theme';
import { Button, Card, Input, Muted, Title } from '@/components/ui';

interface WalletData {
  balancePaise: number;
  freeCredits: number;
  promoCredits: number;
}

interface Tx {
  _id: string;
  kind: string;
  amountPaise: number;
  credits: number;
  note?: string;
  createdAt: string;
}

const KIND_LABEL: Record<string, string> = {
  recharge: 'Wallet recharge',
  call_charge: 'Call charge',
  refund: 'Refund',
  admin_adjustment: 'Adjustment by Relax Go',
  free_credit_grant: 'Free credits added',
  free_credit_consume: 'Free credit used',
  promo_credit_grant: 'Promo credits added',
  promo_credit_consume: 'Promo credit used',
  credit_expiry: 'Credits expired',
};

/** Wallet & credits (spec §24): balance, ledger, recharge through the configured gateway. */
export default function WalletScreen() {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: () => api<WalletData>('/driver/wallet') });
  const txs = useQuery({ queryKey: ['wallet-txs'], queryFn: () => api<{ items: Tx[] }>('/driver/wallet/transactions') });

  const recharge = useMutation({
    mutationFn: async () => {
      const amountPaise = Math.round(Number(amount) * 100);
      const order = await api<{ order: { gatewayOrderId: string; clientData: Record<string, string> } }>('/driver/wallet/recharge', {
        method: 'POST',
        body: { amountPaise },
      });
      // Razorpay checkout opens via its native SDK when the build includes it; the payment is
      // verified server-side either by the verify call or the gateway webhook — never client trust.
      try {
        const { default: RazorpayCheckout } = (await import('react-native-razorpay' as string)) as {
          default: { open: (o: Record<string, unknown>) => Promise<{ razorpay_payment_id: string; razorpay_signature: string }> };
        };
        const result = await RazorpayCheckout.open({
          key: order.order.clientData.keyId,
          order_id: order.order.gatewayOrderId,
          name: 'Relax Go',
          description: 'Wallet recharge',
          currency: 'INR',
          amount: amountPaise,
        });
        await api('/driver/wallet/recharge/verify', {
          method: 'POST',
          body: { orderId: order.order.gatewayOrderId, paymentId: result.razorpay_payment_id, signature: result.razorpay_signature },
        });
      } catch (err) {
        if (err instanceof Error && /Cannot find module|native module/i.test(err.message)) {
          throw new ApiError(0, 'gateway_sdk', 'Payment checkout is not included in this build yet. The order was created; complete it from a build with the payment SDK, or contact support.');
        }
        throw err;
      }
    },
    onSuccess: () => {
      setAmount('');
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      void qc.invalidateQueries({ queryKey: ['wallet-txs'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
      Alert.alert('Recharged', 'Money added to your wallet.');
    },
    onError: (e) => Alert.alert('Recharge', e instanceof Error ? e.message : 'Failed'),
  });

  return (
    <FlatList
      contentContainerStyle={{ padding: 16, gap: 12 }}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <Card style={{ backgroundColor: colors.ink }}>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600', textTransform: 'uppercase' }}>Wallet balance</Text>
            <Text style={{ color: '#fff', fontSize: 34, fontWeight: '800', marginVertical: 4 }}>
              {wallet.data ? formatMoney(wallet.data.balancePaise) : '—'}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>
              Free credits: {wallet.data?.freeCredits ?? '—'} · Promo: {wallet.data?.promoCredits ?? '—'}
            </Text>
          </Card>
          <Card style={{ gap: 10 }}>
            <Title>Add money</Title>
            <Muted>Calls use your free credits first; after that each call is charged from the wallet at the current rate.</Muted>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[100, 200, 500].map((v) => (
                <Button key={v} title={`₹${v}`} variant={amount === String(v) ? 'primary' : 'secondary'} style={{ flex: 1, height: 40 }} onPress={() => setAmount(String(v))} />
              ))}
            </View>
            <Input placeholder="Or enter an amount in ₹" keyboardType="number-pad" value={amount} onChangeText={setAmount} />
            <Button title="Recharge securely" loading={recharge.isPending} disabled={!Number(amount)} onPress={() => recharge.mutate()} />
          </Card>
          <Title>Transactions</Title>
        </View>
      }
      data={txs.data?.items ?? []}
      keyExtractor={(t) => t._id}
      ListEmptyComponent={<Muted center>{txs.isPending ? 'Loading…' : 'No transactions yet.'}</Muted>}
      renderItem={({ item }) => (
        <Card style={{ paddingVertical: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600', color: colors.text, fontSize: 14 }}>{KIND_LABEL[item.kind] ?? item.kind}</Text>
              {item.note ? <Text style={{ color: colors.muted, fontSize: 12 }}>{item.note}</Text> : null}
              <Text style={{ color: colors.faint, fontSize: 11, marginTop: 2 }}>
                {new Date(item.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
            <Text style={{ fontWeight: '700', color: item.amountPaise > 0 || item.credits > 0 ? colors.success : colors.text, fontSize: 15 }}>
              {item.amountPaise ? formatMoney(item.amountPaise) : `${item.credits > 0 ? '+' : ''}${item.credits} cr`}
            </Text>
          </View>
        </Card>
      )}
    />
  );
}
