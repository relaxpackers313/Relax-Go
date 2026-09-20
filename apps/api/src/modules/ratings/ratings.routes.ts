import { Router } from 'express';
import { ratingCreateSchema } from '@relaxgo/shared';
import { asyncRoute, ApiError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import { requireAuth } from '../../middleware/auth';
import { Lead } from '../../models/lead.model';
import { Rating } from '../../models/ops.model';
import { Driver } from '../../models/driver.model';
import { getSettings } from '../settings/settings.service';

export const customerRatingsRouter: Router = Router();
customerRatingsRouter.use(requireAuth('customer'));

/** One rating per lead, only after real contact; aggregates update on the driver, low averages flag for review — never auto-suspend (spec §38). */
customerRatingsRouter.post(
  '/leads/:leadId/rating',
  asyncRoute(async (req, res) => {
    const settings = await getSettings();
    if (!settings.features.ratings) throw ApiError.conflict('Ratings are not enabled');
    const { stars, review } = parse(ratingCreateSchema, req.body);
    const lead = await Lead.findOne({ _id: req.params.leadId, customerSessionId: req.ctx!.id });
    if (!lead) throw ApiError.notFound('Request not found');
    if (!['contacted', 'converted'].includes(lead.status)) {
      throw ApiError.conflict('You can rate after you have connected with the driver');
    }
    if (await Rating.findOne({ leadId: lead._id })) throw ApiError.conflict('You already rated this request');

    const rating = await Rating.create({ leadId: lead._id, driverId: lead.driverId, customerSessionId: req.ctx!.id, stars, review });

    const [agg] = await Rating.aggregate<{ avg: number; count: number }>([
      { $match: { driverId: lead.driverId } },
      { $group: { _id: null, avg: { $avg: '$stars' }, count: { $sum: 1 } } },
    ]);
    const average = Math.round((agg?.avg ?? stars) * 100) / 100;
    const count = agg?.count ?? 1;
    const flagged = count >= settings.ratings.minRatingsBeforeFlag && average < settings.ratings.reviewThreshold;
    await Driver.updateOne(
      { _id: lead.driverId },
      {
        $set: { 'rating.average': average, 'rating.count': count },
        ...(flagged ? { $addToSet: { flags: 'low_rating' } } : { $pull: { flags: 'low_rating' } }),
      },
    );
    res.status(201).json({ id: String(rating._id), stars, average, count });
  }),
);
