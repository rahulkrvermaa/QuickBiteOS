-- =====================================================================
-- QUICKBITE OS: SEED DATA FOR FIRST REAL USE CASE (SAMOSA CORNER)
-- All prices in integer PAISA (1 INR = 100 Paisa)
-- =====================================================================

DO $$
DECLARE
    v_biz_id UUID := 'a0000000-0000-0000-0000-000000000001';
    v_branch_id UUID := 'b0000000-0000-0000-0000-000000000001';
    v_cat_samosas UUID := 'c0000000-0000-0000-0000-000000000001';
    v_cat_kachoris UUID := 'c0000000-0000-0000-0000-000000000002';
    v_cat_chai UUID := 'c0000000-0000-0000-0000-000000000003';
    v_cat_extras UUID := 'c0000000-0000-0000-0000-000000000004';

    v_prod_aloo UUID := 'd0000000-0000-0000-0000-000000000001';
    v_prod_paneer UUID := 'd0000000-0000-0000-0000-000000000002';
    v_prod_moong UUID := 'd0000000-0000-0000-0000-000000000003';
    v_prod_pyaaz UUID := 'd0000000-0000-0000-0000-000000000004';
    v_prod_chai UUID := 'd0000000-0000-0000-0000-000000000005';
    v_prod_lassi UUID := 'd0000000-0000-0000-0000-000000000006';
BEGIN
    -- 1. Insert Business
    INSERT INTO public.businesses (id, name, slug, tagline, phone, address, city, currency, is_active, tier)
    VALUES (
        v_biz_id,
        'Samosa Corner',
        'samosa-corner',
        'Authentic Crispy Samosas, Khasta Kachoris & Kulhad Chai since 1998',
        '+91 83209 17837',
        'Maharajganj Main Rd, near by Sharamahala, Located in: Kali Mandir maharajganj',
        'Jamui, Bihar 811307',
        'INR',
        true,
        'Starter'
    ) ON CONFLICT (id) DO NOTHING;

    -- 2. Insert Branch
    INSERT INTO public.branches (id, business_id, name, code, address, phone, is_primary, is_active)
    VALUES (
        v_branch_id,
        v_biz_id,
        'Jamui Flagship',
        'MAIN',
        'Maharajganj Main Rd, near by Sharamahala, Located in: Kali Mandir maharajganj, Jamui, Bihar 811307',
        '+91 83209 17837',
        true,
        true
    ) ON CONFLICT (id) DO NOTHING;

    -- 3. Business Settings
    INSERT INTO public.business_settings (
        business_id, allow_cash, allow_online, auto_accept_orders, tax_gst_percentage, service_charge_percentage, order_prefix, estimated_prep_minutes
    )
    VALUES (
        v_biz_id, true, true, false, 5.00, 0.00, 'A', 10
    ) ON CONFLICT (business_id) DO NOTHING;

    -- 4. Categories
    INSERT INTO public.categories (id, business_id, name, slug, display_order, is_active)
    VALUES 
        (v_cat_samosas, v_biz_id, 'Hot Samosas', 'hot-samosas', 1, true),
        (v_cat_kachoris, v_biz_id, 'Khasta Kachoris', 'kachoris', 2, true),
        (v_cat_chai, v_biz_id, 'Kulhad Chai & Beverages', 'chai-beverages', 3, true),
        (v_cat_extras, v_biz_id, 'Chutneys & Add-ons', 'chutneys-extras', 4, true)
    ON CONFLICT (id) DO NOTHING;

    -- 5. Products (Integer Paisa)
    INSERT INTO public.products (id, business_id, category_id, name, description, base_price_paisa, is_veg, is_available)
    VALUES
        (v_prod_aloo, v_biz_id, v_cat_samosas, 'Punjabi Aloo Samosa', 'Crispy hand-rolled pastry stuffed with spiced potato and green peas', 2000, true, true),
        (v_prod_paneer, v_biz_id, v_cat_samosas, 'Paneer Tikka Samosa', 'Tender tandoori marinated paneer cubes and dry roasted spices', 3500, true, true),
        (v_prod_moong, v_biz_id, v_cat_kachoris, 'Moong Dal Khasta Kachori', 'Flaky round pastry with spiced yellow moong dal and hing-aloo gravy', 2500, true, true),
        (v_prod_pyaaz, v_biz_id, v_cat_kachoris, 'Jodhpuri Pyaaz Kachori', 'Large crispy kachori with spiced caramelized onions and fennel', 3000, true, true),
        (v_prod_chai, v_biz_id, v_cat_chai, 'Kulhad Masala Chai', 'Freshly brewed milk tea with crushed ginger, cardamom, and Assam tea', 2000, true, true),
        (v_prod_lassi, v_biz_id, v_cat_chai, 'Amritsari Sweet Lassi', 'Thick creamy churned yogurt topped with fresh malai and pistachios', 4000, true, true)
    ON CONFLICT (id) DO NOTHING;

    -- 6. Product Variants
    INSERT INTO public.product_variants (product_id, name, price_override_paisa, is_default)
    VALUES
        (v_prod_aloo, 'Single (1 pc)', 2000, true),
        (v_prod_aloo, 'Plate of 2 pcs', 3800, false),
        (v_prod_paneer, 'Single (1 pc)', 3500, true),
        (v_prod_paneer, 'Plate of 2 pcs', 6500, false),
        (v_prod_chai, 'Regular Masala', 2000, true),
        (v_prod_chai, 'Extra Adrak & Elaichi', 2500, false)
    ON CONFLICT DO NOTHING;

    -- 7. Product Add-ons
    INSERT INTO public.product_addons (product_id, name, price_paisa, max_quantity)
    VALUES
        (v_prod_aloo, 'Extra Saunth Sweet Chutney', 500, 3),
        (v_prod_aloo, 'Extra Spicy Mint Chutney', 500, 3),
        (v_prod_aloo, 'Top with Chole Gravy & Curd', 2500, 1),
        (v_prod_moong, 'Extra Aloo Gravy Bowl', 1500, 2)
    ON CONFLICT DO NOTHING;
END $$;

