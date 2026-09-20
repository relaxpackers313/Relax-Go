import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, ApiError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAuth } from '../../middleware/auth';
import { CustomerSession } from '../../models/customer.model';
import { Lead } from '../../models/lead.model';

/** Customer self-service: favourite places and recent locations (spec §4). */
export const customerSelfRouter: Router = Router();
customerSelfRouter.use(requireAuth('customer'));

const favoriteSchema = z.object({
  label: z.string().min(1).max(60),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(300).optional(),
});

customerSelfRouter.get(
  '/favorites',
  asyncRoute(async (req, res) => {
    const session = await CustomerSession.findById(req.ctx!.id);
    res.json({ items: session?.favorites ?? [] });
  }),
);

customerSelfRouter.post(
  '/favorites',
  asyncRoute(async (req, res) => {
    const input = parse(favoriteSchema, req.body);
    const session = await CustomerSession.findById(req.ctx!.id);
    if (!session) throw ApiError.notFound('Session not found');
    if ((session.favorites?.length ?? 0) >= 20) throw ApiError.conflict('Favourite list is full (20 places)');
    session.favorites.push(input as never);
    await session.save();
    res.status(201).json({ items: session.favorites });
  }),
);

customerSelfRouter.delete(
  '/favorites/:index',
  asyncRoute(async (req, res) => {
    const index = Number(req.params.index);
    const session = await CustomerSession.findById(req.ctx!.id);
    if (!session || !Number.isInteger(index) || index < 0 || index >= (session.favorites?.length ?? 0)) {
      throw ApiError.notFound('Favourite not found');
    }
    session.favorites.splice(index, 1);
    await session.save();
    res.json({ items: session.favorites });
  }),
);

/** Recent pickup/destination places from this session's own leads. */
customerSelfRouter.get(
  '/recents',
  asyncRoute(async (req, res) => {
    const leads = await Lead.find({ customerSessionId: req.ctx!.id }).sort({ createdAt: -1 }).limit(30).select('pickup destination');
    const seen = new Set<string>();
    const items: { label: string; lat: number; lng: number }[] = [];
    for (const lead of leads) {
      for (const place of [lead.destination, lead.pickup]) {
        const address = place?.address;
        if (!place || !address || seen.has(address)) continue;
        seen.add(address);
        const [lng, lat] = (place.location as { coordinates: [number, number] }).coordinates;
        items.push({ label: address, lat, lng });
        if (items.length >= 8) break;
      }
      if (items.length >= 8) break;
    }
    res.json({ items });
  }),
);
