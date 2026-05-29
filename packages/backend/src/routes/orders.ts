import { Router, type Request, type Response } from 'express';
import type { BrokerAdapter } from '../broker/BrokerAdapter.js';
import type { OrderRequest } from '../broker/types.js';

const VALID_ORDER_TYPES = new Set(['MARKET', 'LIMIT', 'STOP', 'MARKET_IF_TOUCHED']);

export function createOrderRoutes(broker: BrokerAdapter): Router {
  const router = Router();

  router.get('/pending', async (_req: Request, res: Response) => {
    try {
      const orders = await broker.getPendingOrders();
      res.json({ count: orders.length, orders });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      const { instrument, units, type, price, stopLossPrice, takeProfitPrice, priceBound } = req.body;

      if (!instrument || !units || !type) {
        res.status(400).json({ error: 'Missing required fields: instrument, units, type' });
        return;
      }

      if (!VALID_ORDER_TYPES.has(type)) {
        res.status(400).json({ error: `Invalid order type: ${type}` });
        return;
      }

      const parsedUnits = parseInt(units);
      if (isNaN(parsedUnits) || parsedUnits === 0) {
        res.status(400).json({ error: 'units must be a non-zero integer' });
        return;
      }

      const order: OrderRequest = {
        instrument,
        units: parsedUnits,
        type,
        price: price ? parseFloat(price) : undefined,
        stopLossPrice: stopLossPrice ? parseFloat(stopLossPrice) : undefined,
        takeProfitPrice: takeProfitPrice ? parseFloat(takeProfitPrice) : undefined,
        priceBound: priceBound ? parseFloat(priceBound) : undefined,
      };

      const result = await broker.placeOrder(order);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/cancel/:orderId', async (req: Request, res: Response) => {
    try {
      await broker.cancelOrder(req.params.orderId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
