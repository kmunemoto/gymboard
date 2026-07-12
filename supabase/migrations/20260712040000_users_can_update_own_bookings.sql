-- 同日キャンセル消化機能（#116）で、お客様の自己キャンセルが「消化扱い」
-- のとき bookings.status を UPDATE する経路（cancelBooking の forfeit）が
-- 追加されたが、bookings には「Trainers can update any bookings」しか
-- UPDATE ポリシーが無く、お客様自身の UPDATE を許可するポリシーが存在
-- しなかった。RLS はマッチしない行を対象外にするだけでエラーにしないため、
-- update は「成功（対象0件）」となり、通知は送られるのに実際の行は
-- 更新されない不整合が発生していた（トレーナー起因のキャンセルは
-- 元々トレーナー権限でUPDATEできていたため無事だった）。
--
-- DELETE ポリシー（Users can delete own bookings）と同じ範囲（自分の行のみ）で
-- UPDATE を許可する。
CREATE POLICY "Users can update own bookings"
  ON public.bookings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
