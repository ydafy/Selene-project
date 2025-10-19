import express, { Request, Response } from 'express';
import cors from 'cors';
import type { SharedUser } from '@school/types';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/', (req: Request, res: Response) => {
    const testUser: SharedUser = { id: '123', email: 'test@test.com' };
  console.log('Usuario de tipo compartido:', testUser);
  res.send('¡Hola Mundo desde el Backend del Portal Escolar!');
});

app.listen(port, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${port}`);
});
